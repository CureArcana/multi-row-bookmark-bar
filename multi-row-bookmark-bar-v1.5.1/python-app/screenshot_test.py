#!/usr/bin/env python3
"""Take screenshot of the bookmark bar with sample data."""
import os, sys, json, tempfile, shutil
os.environ["QT_QPA_PLATFORM"] = "offscreen"

from PyQt5.QtWidgets import QApplication
from PyQt5.QtCore import QTimer
from PyQt5.QtGui import QPixmap

# Patch config dirs to temp
_tmpdir = tempfile.mkdtemp(prefix="mrbb_ss_")
import main as m
m.CONFIG_DIR = type(m.CONFIG_DIR)(_tmpdir)
m.BOOKMARKS_FILE = m.CONFIG_DIR / "bookmarks.json"
m.SETTINGS_FILE = m.CONFIG_DIR / "settings.json"
m.FAVICON_CACHE_DIR = m.CONFIG_DIR / "favicons"
m.FAVICON_CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Create sample bookmarks
data = {"version": 1, "bookmarks": []}
sites = [
    ("Google", "https://www.google.com"),
    ("YouTube", "https://www.youtube.com"),
    ("Twitter/X", "https://x.com"),
    ("GitHub", "https://github.com"),
    ("Reddit", "https://www.reddit.com"),
    ("Amazon", "https://www.amazon.co.jp"),
    ("Wikipedia", "https://wikipedia.org"),
    ("DLsite", "https://www.dlsite.com"),
    ("Pixiv", "https://www.pixiv.net"),
    ("Discord", "https://discord.com"),
    ("Slack", "https://slack.com"),
    ("Stack Overflow", "https://stackoverflow.com"),
    ("Twitch", "https://www.twitch.tv"),
    ("Netflix", "https://www.netflix.com"),
    ("ChatGPT", "https://chat.openai.com"),
    ("Claude", "https://claude.ai"),
    ("Notion", "https://www.notion.so"),
    ("Figma", "https://www.figma.com"),
]
for i, (title, url) in enumerate(sites):
    data["bookmarks"].append({
        "id": f"bm{i}", "title": title, "url": url, "isFolder": False
    })
# Add folders
data["bookmarks"].append({
    "id": "f1", "title": "同人音声", "url": "", "isFolder": True,
    "children": [
        {"id": "fc1", "title": "DLsite", "url": "https://www.dlsite.com", "isFolder": False},
        {"id": "fc2", "title": "FANZA", "url": "https://www.dmm.co.jp", "isFolder": False},
    ]
})
data["bookmarks"].append({
    "id": "f2", "title": "開発ツール", "url": "", "isFolder": True,
    "children": [
        {"id": "fc3", "title": "VSCode", "url": "https://code.visualstudio.com", "isFolder": False},
        {"id": "fc4", "title": "PyPI", "url": "https://pypi.org", "isFolder": False},
    ]
})
# More items for multi-row
more = [
    ("Spotify", "https://www.spotify.com"),
    ("LINE", "https://line.me"),
    ("Yahoo Japan", "https://www.yahoo.co.jp"),
    ("NicoNico", "https://www.nicovideo.jp"),
    ("Qiita", "https://qiita.com"),
]
for i, (title, url) in enumerate(more):
    data["bookmarks"].append({
        "id": f"bm_m{i}", "title": title, "url": url, "isFolder": False
    })

with open(m.BOOKMARKS_FILE, "w") as f:
    json.dump(data, f, ensure_ascii=False)
with open(m.SETTINGS_FILE, "w") as f:
    json.dump(m.DEFAULT_SETTINGS, f)

app = QApplication(sys.argv)
OUTPUT = sys.argv[1] if len(sys.argv) > 1 else "/sessions/brave-nifty-cori/mnt/GoogleMultiBar/multi-row-bookmark-bar-v1.5.1/python-app/screenshot.png"

def take_screenshot():
    try:
        bar = m.BookmarkBar()
        bar.setGeometry(0, 0, 1200, 400)
        bar._build_bar()
        bar.show()
        app.processEvents()

        # Grab the widget
        px = bar.grab()
        px.save(OUTPUT, "PNG")
        print(f"Screenshot saved: {OUTPUT}")
        print(f"  Size: {px.width()}x{px.height()}")
        print(f"  Rows: {bar._bg_layout.count()}")
        print(f"  Bookmarks: {len(bar.store.bookmarks)}")
        bar.close()
    except Exception as e:
        print(f"Screenshot failed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        shutil.rmtree(_tmpdir, ignore_errors=True)
        app.quit()

QTimer.singleShot(200, take_screenshot)
app.exec_()
