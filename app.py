import os
import re
import uuid
import logging
import numpy as np
import soundfile as sf
import scipy.signal as signal
from flask import Flask, request, jsonify, send_file, render_template, abort
from flask_cors import CORS
from werkzeug.utils import secure_filename

# Static mapping prevents user-controlled strings from reaching os.path.join directly
TRACK_FILES = {
    'vocals': 'vocals.wav',
    'accompaniment': 'accompaniment.wav',
}

_UUID_RE = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
)

logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = os.path.realpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'uploads')
)
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50 MB

ALLOWED_EXTENSIONS = {'mp3', 'wav', 'flac', 'ogg', 'm4a'}


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def _resolve_session_dir(session_id: str) -> str:
    """
    Validate that *session_id* is a UUID v4 string and return the
    fully-resolved absolute path for its upload directory.

    Raises a 400 HTTP error if the resulting path would escape UPLOAD_FOLDER.
    """
    if not _UUID_RE.match(session_id):
        abort(400)
    # UUID v4 strings contain only hex digits and hyphens, so no traversal is
    # possible, but we call realpath and verify the prefix as a belt-and-braces
    # defence-in-depth measure.
    candidate = os.path.realpath(os.path.join(UPLOAD_FOLDER, session_id))
    if not candidate.startswith(UPLOAD_FOLDER + os.sep):
        abort(400)
    return candidate


def _resolve_track_file(session_dir: str, track: str) -> str:
    """
    Map *track* to its static filename, join with *session_dir*, and verify
    the result remains inside *session_dir*.  Returns the resolved path.

    *session_dir* must already be a validated realpath (from _resolve_session_dir).
    Raises 400 if track is invalid or path resolution escapes session_dir.
    """
    track_filename = TRACK_FILES.get(track)
    if track_filename is None:
        abort(400)
    file_path = os.path.realpath(os.path.join(session_dir, track_filename))
    if not file_path.startswith(session_dir + os.sep):
        abort(400)
    return file_path


def separate_audio(input_path: str, session_dir: str) -> None:
    """
    Separate audio into vocals and accompaniment using centre-channel extraction.
    Writes vocals.wav and accompaniment.wav into *session_dir*.
    """
    data, sample_rate = sf.read(input_path)

    # Convert mono to stereo if needed
    if data.ndim == 1:
        data = np.stack([data, data], axis=1)

    data = data.astype(np.float64)

    left = data[:, 0]
    right = data[:, 1]

    # Vocal extraction: centre channel (content common to both sides)
    vocals = (left + right) / 2.0

    # Accompaniment: side channel (stereo-panned instruments)
    accompaniment = (left - right) / 2.0

    # High-pass filter to remove residual low-end hum from accompaniment
    sos = signal.butter(4, 80 / (sample_rate / 2), btype='high', output='sos')
    accompaniment_filtered = signal.sosfilt(sos, accompaniment)
    accompaniment_stereo = np.stack([accompaniment_filtered, -accompaniment_filtered], axis=1)
    vocals_stereo = np.stack([vocals, vocals], axis=1)

    def normalize(arr):
        peak = np.max(np.abs(arr))
        if peak > 0:
            arr = arr / peak * 0.9
        return arr

    vocals_path = os.path.join(session_dir, TRACK_FILES['vocals'])
    accompaniment_path = os.path.join(session_dir, TRACK_FILES['accompaniment'])

    sf.write(vocals_path, normalize(vocals_stereo), sample_rate)
    sf.write(accompaniment_path, normalize(accompaniment_stereo), sample_rate)


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400

    if not allowed_file(file.filename):
        return jsonify({'error': 'File type not allowed. Use mp3, wav, flac, ogg, or m4a'}), 400

    filename = secure_filename(file.filename)
    if not filename:
        return jsonify({'error': 'Invalid filename'}), 400

    session_id = str(uuid.uuid4())
    session_dir = os.path.join(UPLOAD_FOLDER, session_id)
    os.makedirs(session_dir, exist_ok=True)

    # Filename is sanitised by secure_filename; session_dir is derived from a
    # freshly-generated UUID, so no traversal risk exists here.
    input_path = os.path.join(session_dir, filename)
    file.save(input_path)

    return jsonify({'session_id': session_id, 'filename': filename})


@app.route('/process/<session_id>', methods=['POST'])
def process_audio(session_id):
    session_dir = _resolve_session_dir(session_id)
    if not os.path.isdir(session_dir):
        return jsonify({'error': 'Session not found'}), 404

    input_files = [
        f for f in os.listdir(session_dir)
        if f.lower().endswith(tuple(ALLOWED_EXTENSIONS))
    ]

    if not input_files:
        return jsonify({'error': 'No audio file found in session'}), 404

    # Use basename to ensure no traversal from a filename found on-disk
    safe_name = os.path.basename(input_files[0])
    input_path = os.path.join(session_dir, safe_name)

    try:
        separate_audio(input_path, session_dir)
        return jsonify({
            'status': 'done',
            'tracks': {
                'vocals': f'/stream/{session_id}/vocals',
                'accompaniment': f'/stream/{session_id}/accompaniment',
            }
        })
    except Exception:
        logger.exception('Audio processing failed for session %s', session_id)
        return jsonify({'error': 'Audio processing failed. Please try a different file.'}), 500


@app.route('/download/<session_id>/<track>')
def download_track(session_id, track):
    session_dir = _resolve_session_dir(session_id)
    file_path = _resolve_track_file(session_dir, track)

    if not os.path.isfile(file_path):
        return jsonify({'error': 'File not found'}), 404

    # track_filename comes from the static TRACK_FILES dict, not from user input
    track_filename = TRACK_FILES[track]
    return send_file(
        file_path,
        mimetype='audio/wav',
        as_attachment=True,
        download_name=track_filename,
    )


@app.route('/stream/<session_id>/<track>')
def stream_track(session_id, track):
    session_dir = _resolve_session_dir(session_id)
    file_path = _resolve_track_file(session_dir, track)

    if not os.path.isfile(file_path):
        return jsonify({'error': 'File not found'}), 404

    return send_file(file_path, mimetype='audio/wav')


if __name__ == '__main__':
    app.run(debug=False, host='0.0.0.0', port=5000)
