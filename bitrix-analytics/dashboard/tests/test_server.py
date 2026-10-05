import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

import server
from tests.synth import PII_MARKERS, write_csv


@pytest.fixture
def base_url(tmp_path):
    f = tmp_path / "d.csv"
    write_csv(f, n=120)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.make_handler(server.DataStore(f)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}", f
    httpd.shutdown()


def get(url):
    with urllib.request.urlopen(url) as r:
        return r.status, dict(r.headers), r.read()


def test_api_returns_compact_rows_without_personal_data(base_url):
    url, _ = base_url
    status, headers, body = get(url + "/api/deals")
    data = json.loads(body)
    assert status == 200
    assert data["fields"][0] == "created" and len(data["rows"]) == 120
    assert "group" in data["dicts"] and data["meta"]["groups"][-1] == "Другое"
    for marker in PII_MARKERS:
        assert marker.encode() not in body
    assert "connect-src 'self'" in headers["Content-Security-Policy"]
    assert headers["Cache-Control"] == "no-store"


def test_index_and_static(base_url):
    url, _ = base_url
    assert b"<title>" in get(url + "/")[2]
    assert get(url + "/app.js")[0] == 200


@pytest.mark.parametrize("path", ["/../settings.py", "/..%2fsettings.py", "/nope.js", "/static/", "/app.py"])
def test_no_access_outside_static(base_url, path):
    url, _ = base_url
    with pytest.raises(urllib.error.HTTPError) as e:
        get(url + path)
    assert e.value.code == 404


def test_reloads_when_file_changes(base_url):
    url, f = base_url
    assert len(json.loads(get(url + "/api/deals")[2])["rows"]) == 120
    write_csv(f, n=30, seed=2)
    assert len(json.loads(get(url + "/api/deals")[2])["rows"]) == 30


def test_error_is_reported_as_json(tmp_path, monkeypatch):
    monkeypatch.setattr(server.settings, "DATA_DIR", tmp_path)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.make_handler(server.DataStore()))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        body = json.loads(get(f"http://127.0.0.1:{httpd.server_address[1]}/api/deals")[2])
        assert "нет файлов .csv" in body["error"]
    finally:
        httpd.shutdown()
