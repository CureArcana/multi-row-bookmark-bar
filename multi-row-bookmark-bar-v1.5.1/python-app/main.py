#!/usr/bin/env python3
"""
Multi-Row Bookmark Bar v1.5.1 — 完全独立型デスクトップブックマークバー
PyQt5 フレームレスオーバーレイで、どのブラウザでも使える汎用ブックマークバー。
"""

import sys
import os
import json
import subprocess
import platform
import hashlib
import urllib.request
import urllib.error
from pathlib import Path
from typing import Optional, List, Dict, Any

from PyQt5.QtWidgets import (
    QApplication, QWidget, QHBoxLayout, QVBoxLayout, QLabel,
    QPushButton, QMenu, QAction, QInputDialog, QMessageBox,
    QSizePolicy, QScrollArea, QFrame, QToolTip, QSystemTrayIcon,
    QWidgetAction, QSpinBox, QComboBox, QDialog, QFormLayout,
    QDialogButtonBox, QLineEdit
)
from PyQt5.QtCore import (
    Qt, QTimer, QPoint, QRect, QSize, QUrl, QThread, pyqtSignal,
    QMimeData, QByteArray, QPropertyAnimation, QEasingCurve
)
from PyQt5.QtGui import (
    QPixmap, QIcon, QFont, QPainter, QColor, QCursor, QDrag,
    QPalette, QFontMetrics, QPen, QBrush, QImage
)
from PyQt5.QtNetwork import QNetworkAccessManager, QNetworkRequest, QNetworkReply

# ===== Platform-specific imports for window tracking =====
if platform.system() == "Windows":
    try:
        import ctypes
        import ctypes.wintypes
        HAS_WIN32 = True
    except ImportError:
        HAS_WIN32 = False
else:
    HAS_WIN32 = False


# ===== Constants =====
APP_NAME = "MultiRowBookmarkBar"
APP_VERSION = "1.5.1"
CONFIG_DIR = Path.home() / ".config" / "multi-row-bookmark-bar"
BOOKMARKS_FILE = CONFIG_DIR / "bookmarks.json"
SETTINGS_FILE = CONFIG_DIR / "settings.json"
FAVICON_CACHE_DIR = CONFIG_DIR / "favicons"

DEFAULT_SETTINGS = {
    "fontSize": 12,
    "barHeight": 34,
    "maxRows": 0,
    "displayMode": "both",       # "both", "icon_only", "text_only"
    "folderOpenMode": "hover",   # "hover", "click"
    "barOpacity": 0.97,
    "targetBrowser": "auto",     # "auto", "chrome", "edge", "firefox", "custom"
    "customBrowserPath": "",
    "alwaysOnTop": True,
    "autoTrack": True,
    "chromeBarOffset": 0,        # 0 = 自動検出, >0 = 手動指定(px)
}

DEFAULT_BOOKMARKS = {
    "version": 1,
    "bookmarks": []
}

# Folder icon SVG as data (rendered to QPixmap)
FOLDER_COLOR = QColor("#F0B400")
FALLBACK_COLOR = QColor("#E8EAED")

# ===== Data Model =====

def generate_id():
    """Generate a unique ID for a bookmark item."""
    import time
    return hashlib.md5(f"{time.time()}{os.urandom(8).hex()}".encode()).hexdigest()[:12]


class BookmarkItem:
    """Single bookmark or folder."""
    def __init__(self, id: str = "", title: str = "", url: str = "",
                 is_folder: bool = False, children: Optional[List] = None):
        self.id = id or generate_id()
        self.title = title
        self.url = url
        self.is_folder = is_folder
        self.children: List[BookmarkItem] = children or []

    def to_dict(self) -> dict:
        d = {"id": self.id, "title": self.title, "url": self.url, "isFolder": self.is_folder}
        if self.is_folder:
            d["children"] = [c.to_dict() for c in self.children]
        return d

    @staticmethod
    def from_dict(d: dict) -> 'BookmarkItem':
        item = BookmarkItem(
            id=d.get("id", generate_id()),
            title=d.get("title", ""),
            url=d.get("url", ""),
            is_folder=d.get("isFolder", False)
        )
        if item.is_folder:
            item.children = [BookmarkItem.from_dict(c) for c in d.get("children", [])]
        return item


class BookmarkStore:
    """Manages bookmark persistence."""
    def __init__(self):
        self.bookmarks: List[BookmarkItem] = []
        self._ensure_dirs()
        self.load()

    def _ensure_dirs(self):
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        FAVICON_CACHE_DIR.mkdir(parents=True, exist_ok=True)

    def load(self):
        if BOOKMARKS_FILE.exists():
            try:
                with open(BOOKMARKS_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self.bookmarks = [BookmarkItem.from_dict(b) for b in data.get("bookmarks", [])]
            except Exception as e:
                print(f"[MRBB] Failed to load bookmarks: {e}")
                self.bookmarks = []
        else:
            self.bookmarks = []
            self.save()

    def save(self):
        data = {"version": 1, "bookmarks": [b.to_dict() for b in self.bookmarks]}
        try:
            with open(BOOKMARKS_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"[MRBB] Failed to save bookmarks: {e}")

    def add_bookmark(self, title: str, url: str, parent_id: str = "") -> BookmarkItem:
        item = BookmarkItem(title=title, url=url)
        parent = self._find_by_id(parent_id) if parent_id else None
        if parent and parent.is_folder:
            parent.children.append(item)
        else:
            self.bookmarks.append(item)
        self.save()
        return item

    def add_folder(self, title: str, parent_id: str = "") -> BookmarkItem:
        item = BookmarkItem(title=title, is_folder=True)
        parent = self._find_by_id(parent_id) if parent_id else None
        if parent and parent.is_folder:
            parent.children.append(item)
        else:
            self.bookmarks.append(item)
        self.save()
        return item

    def delete_item(self, item_id: str) -> bool:
        if self._remove_from_list(self.bookmarks, item_id):
            self.save()
            return True
        return False

    def update_item(self, item_id: str, title: str = None, url: str = None):
        item = self._find_by_id(item_id)
        if item:
            if title is not None:
                item.title = title
            if url is not None:
                item.url = url
            self.save()

    def move_item(self, item_id: str, target_parent_id: str, index: int = -1):
        item = self._extract_item(item_id)
        if not item:
            return
        if target_parent_id:
            parent = self._find_by_id(target_parent_id)
            if parent and parent.is_folder:
                if index >= 0:
                    parent.children.insert(index, item)
                else:
                    parent.children.append(item)
            else:
                if index >= 0:
                    self.bookmarks.insert(index, item)
                else:
                    self.bookmarks.append(item)
        else:
            if index >= 0:
                self.bookmarks.insert(index, item)
            else:
                self.bookmarks.append(item)
        self.save()

    def _find_by_id(self, item_id: str, items: List[BookmarkItem] = None) -> Optional[BookmarkItem]:
        if items is None:
            items = self.bookmarks
        for item in items:
            if item.id == item_id:
                return item
            if item.is_folder:
                found = self._find_by_id(item_id, item.children)
                if found:
                    return found
        return None

    def _remove_from_list(self, items: List[BookmarkItem], item_id: str) -> bool:
        for i, item in enumerate(items):
            if item.id == item_id:
                items.pop(i)
                return True
            if item.is_folder and self._remove_from_list(item.children, item_id):
                return True
        return False

    def _extract_item(self, item_id: str, items: List[BookmarkItem] = None) -> Optional[BookmarkItem]:
        if items is None:
            items = self.bookmarks
        for i, item in enumerate(items):
            if item.id == item_id:
                return items.pop(i)
            if item.is_folder:
                found = self._extract_item(item_id, item.children)
                if found:
                    return found
        return None


# ===== Settings Manager =====

class SettingsManager:
    def __init__(self):
        self.settings = dict(DEFAULT_SETTINGS)
        self.load()

    def load(self):
        if SETTINGS_FILE.exists():
            try:
                with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self.settings.update(data)
            except Exception:
                pass

    def save(self):
        try:
            with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
                json.dump(self.settings, f, indent=2)
        except Exception as e:
            print(f"[MRBB] Failed to save settings: {e}")

    def get(self, key: str, default=None):
        return self.settings.get(key, default)

    def set(self, key: str, value):
        self.settings[key] = value
        self.save()


# ===== Favicon Manager =====

class FaviconManager:
    """Fetches and caches favicons for URLs."""
    def __init__(self):
        self._cache: Dict[str, QPixmap] = {}
        self._nam = QNetworkAccessManager()
        self._pending: Dict[str, list] = {}  # url -> [callbacks]
        FAVICON_CACHE_DIR.mkdir(parents=True, exist_ok=True)

    def get_favicon(self, url: str, callback=None) -> Optional[QPixmap]:
        """Get favicon for URL. Returns cached version or None (fetches async)."""
        if not url:
            return self._fallback_icon()

        try:
            hostname = QUrl(url).host()
        except Exception:
            return self._fallback_icon()

        if not hostname:
            return self._fallback_icon()

        # Check memory cache
        if hostname in self._cache:
            return self._cache[hostname]

        # Check disk cache
        cache_path = FAVICON_CACHE_DIR / f"{hostname}.png"
        if cache_path.exists():
            px = QPixmap(str(cache_path))
            if not px.isNull():
                self._cache[hostname] = px
                return px

        # Fetch async
        if callback:
            if hostname in self._pending:
                self._pending[hostname].append(callback)
            else:
                self._pending[hostname] = [callback]
                self._fetch_favicon(hostname)

        return self._fallback_icon()

    def _fetch_favicon(self, hostname: str):
        favicon_url = f"https://www.google.com/s2/favicons?domain={hostname}&sz=32"
        request = QNetworkRequest(QUrl(favicon_url))
        reply = self._nam.get(request)
        reply.finished.connect(lambda: self._on_favicon_fetched(reply, hostname))

    def _on_favicon_fetched(self, reply: QNetworkReply, hostname: str):
        if reply.error() == QNetworkReply.NoError:
            data = reply.readAll()
            px = QPixmap()
            px.loadFromData(data)
            if not px.isNull():
                px = px.scaled(16, 16, Qt.KeepAspectRatio, Qt.SmoothTransformation)
                self._cache[hostname] = px
                # Save to disk
                cache_path = FAVICON_CACHE_DIR / f"{hostname}.png"
                px.save(str(cache_path), "PNG")
                # Notify callbacks
                for cb in self._pending.get(hostname, []):
                    try:
                        cb(px)
                    except Exception:
                        pass
        self._pending.pop(hostname, None)
        reply.deleteLater()

    @staticmethod
    def _fallback_icon() -> QPixmap:
        px = QPixmap(16, 16)
        px.fill(Qt.transparent)
        painter = QPainter(px)
        painter.setRenderHint(QPainter.Antialiasing)
        painter.setBrush(QBrush(FALLBACK_COLOR))
        painter.setPen(QPen(QColor("#9AA0A6"), 1))
        painter.drawEllipse(1, 1, 14, 14)
        painter.end()
        return px

    @staticmethod
    def folder_icon() -> QPixmap:
        px = QPixmap(16, 16)
        px.fill(Qt.transparent)
        painter = QPainter(px)
        painter.setRenderHint(QPainter.Antialiasing)
        painter.setBrush(QBrush(FOLDER_COLOR))
        painter.setPen(Qt.NoPen)
        # Tab
        painter.drawRoundedRect(1, 2, 6, 3, 1, 1)
        # Body
        painter.drawRoundedRect(1, 4, 14, 10, 2, 2)
        # Lighter front
        painter.setBrush(QBrush(QColor("#F9D648")))
        painter.drawRoundedRect(1, 7, 14, 7, 2, 2)
        painter.end()
        return px


# ===== Bookmark Item Widget =====

class BookmarkItemWidget(QLabel):
    """A single bookmark or folder button in the bar."""
    clicked = pyqtSignal(str)  # url or folder_id
    folderHovered = pyqtSignal(object, object)  # BookmarkItem, widget
    contextMenuRequested = pyqtSignal(object, object)  # BookmarkItem, QPoint

    def __init__(self, item: BookmarkItem, display_mode: str, font_size: int,
                 bar_height: int, favicon_mgr: FaviconManager, parent=None):
        super().__init__(parent)
        self.item = item
        self.display_mode = display_mode
        self.font_size = font_size
        self.bar_height = bar_height
        self.favicon_mgr = favicon_mgr
        self._icon_pixmap: Optional[QPixmap] = None
        self._hovered = False
        self._drag_start_pos = None

        self.setMouseTracking(True)
        self.setCursor(Qt.PointingHandCursor)
        self.setAcceptDrops(True)

        # Setup appearance
        item_h = max(bar_height - 6, 16)
        self.setFixedHeight(item_h)
        self.setFont(QFont("Segoe UI", font_size))

        # Load icon
        if display_mode != "text_only":
            if item.is_folder:
                self._icon_pixmap = FaviconManager.folder_icon()
            else:
                self._icon_pixmap = favicon_mgr.get_favicon(
                    item.url,
                    callback=self._on_favicon_loaded
                )

        self._update_size()
        self.setToolTip(item.title + ("\n" + item.url if item.url else ""))

    def _on_favicon_loaded(self, pixmap: QPixmap):
        self._icon_pixmap = pixmap
        self.update()

    def _update_size(self):
        w = 16  # padding
        if self.display_mode != "text_only" and self._icon_pixmap:
            w += 16
        if self.display_mode != "icon_only" and self.item.title:
            if self.display_mode != "text_only":
                w += 6  # gap
            fm = QFontMetrics(self.font())
            tw = min(fm.horizontalAdvance(self.item.title), 150)
            w += tw
        self.setFixedWidth(max(w, 24))

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)

        # Background
        if self._hovered:
            painter.setBrush(QBrush(QColor(0, 0, 0, 20)))
            painter.setPen(Qt.NoPen)
            painter.drawRoundedRect(self.rect(), 4, 4)

        x = 8
        y_center = self.height() // 2

        # Icon
        if self.display_mode != "text_only" and self._icon_pixmap:
            painter.drawPixmap(x, y_center - 8, 16, 16, self._icon_pixmap)
            x += 16

        # Title
        if self.display_mode != "icon_only" and self.item.title:
            if self.display_mode != "text_only":
                x += 6
            painter.setPen(QPen(QColor("#3C4043")))
            painter.setFont(self.font())
            text_rect = self.rect().adjusted(x, 0, -8, 0)
            elided = painter.fontMetrics().elidedText(self.item.title, Qt.ElideRight, min(150, text_rect.width()))
            painter.drawText(text_rect, Qt.AlignVCenter | Qt.AlignLeft, elided)

        painter.end()

    def enterEvent(self, event):
        self._hovered = True
        self.update()
        if self.item.is_folder:
            self.folderHovered.emit(self.item, self)

    def leaveEvent(self, event):
        self._hovered = False
        self.update()

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            self._drag_start_pos = event.pos()
        elif event.button() == Qt.RightButton:
            self.contextMenuRequested.emit(self.item, event.globalPos())

    def mouseReleaseEvent(self, event):
        if event.button() == Qt.LeftButton:
            if self._drag_start_pos and (event.pos() - self._drag_start_pos).manhattanLength() < 10:
                if self.item.is_folder:
                    self.clicked.emit(self.item.id)
                elif self.item.url:
                    self.clicked.emit(self.item.url)
        self._drag_start_pos = None

    def mouseMoveEvent(self, event):
        if self._drag_start_pos and (event.pos() - self._drag_start_pos).manhattanLength() > 10:
            drag = QDrag(self)
            mime = QMimeData()
            mime.setText(self.item.id)
            mime.setData("application/x-mrbb-id", self.item.id.encode())
            drag.setMimeData(mime)
            # Create drag pixmap
            px = QPixmap(self.size())
            px.fill(Qt.transparent)
            self.render(px)
            drag.setPixmap(px)
            drag.setHotSpot(event.pos())
            drag.exec_(Qt.MoveAction)
            self._drag_start_pos = None

    def dragEnterEvent(self, event):
        if event.mimeData().hasFormat("application/x-mrbb-id"):
            event.acceptProposedAction()

    def dropEvent(self, event):
        source_id = bytes(event.mimeData().data("application/x-mrbb-id")).decode()
        if source_id and source_id != self.item.id:
            if self.item.is_folder:
                # Drop into folder
                event.acceptProposedAction()
                self.window()._move_item_to_folder(source_id, self.item.id)
            else:
                event.acceptProposedAction()
                self.window()._move_item_before(source_id, self.item.id)


# ===== Folder Dropdown =====

class FolderDropdown(QWidget):
    """Popup dropdown for folder contents."""
    def __init__(self, folder: BookmarkItem, anchor_widget: QWidget,
                 bar: 'BookmarkBar', parent=None):
        super().__init__(parent, Qt.Popup | Qt.FramelessWindowHint)
        self.folder = folder
        self.anchor = anchor_widget
        self.bar = bar
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setMouseTracking(True)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(4, 4, 4, 4)
        layout.setSpacing(0)

        self.setStyleSheet("""
            QWidget {
                background: white;
                border: 1px solid #dadce0;
                border-radius: 8px;
                font-family: "Segoe UI", system-ui;
            }
        """)

        if not folder.children:
            empty = QLabel("(empty)")
            empty.setStyleSheet("color: #9aa0a6; padding: 8px 16px; font-size: 12px;")
            layout.addWidget(empty)
        else:
            for child in folder.children:
                row = self._create_row(child)
                layout.addWidget(row)

        # Position below anchor
        anchor_rect = anchor_widget.rect()
        global_pos = anchor_widget.mapToGlobal(QPoint(0, anchor_rect.height()))
        self.adjustSize()
        self.move(global_pos)

        # Ensure on screen
        screen = QApplication.primaryScreen().availableGeometry()
        if self.x() + self.width() > screen.right():
            self.move(screen.right() - self.width(), self.y())
        if self.y() + self.height() > screen.bottom():
            self.move(self.x(), global_pos.y() - self.height() - anchor_rect.height())

    def _create_row(self, item: BookmarkItem) -> QWidget:
        row = QWidget()
        row.setFixedHeight(32)
        row.setCursor(Qt.PointingHandCursor)
        row.setStyleSheet("""
            QWidget { padding: 4px 8px; border-radius: 4px; border: none; }
            QWidget:hover { background: #f1f3f4; }
        """)
        h = QHBoxLayout(row)
        h.setContentsMargins(8, 4, 8, 4)
        h.setSpacing(8)

        # Icon
        icon_label = QLabel()
        icon_label.setFixedSize(16, 16)
        if item.is_folder:
            icon_label.setPixmap(FaviconManager.folder_icon())
        else:
            px = self.bar.favicon_mgr.get_favicon(item.url)
            if px:
                icon_label.setPixmap(px)
        h.addWidget(icon_label)

        # Title
        title = QLabel(item.title or item.url or "")
        title.setStyleSheet("color: #202124; font-size: 12px; border: none;")
        title.setMaximumWidth(250)
        h.addWidget(title, 1)

        # Arrow for folders
        if item.is_folder:
            arrow = QLabel("▶")
            arrow.setStyleSheet("color: #9aa0a6; font-size: 10px; border: none;")
            h.addWidget(arrow)

        # Click handler
        row.mousePressEvent = lambda e, it=item: self._on_row_click(e, it)
        row.setContextMenuPolicy(Qt.CustomContextMenu)
        row.customContextMenuRequested.connect(lambda pos, it=item, w=row: self._on_row_context(it, w.mapToGlobal(pos)))

        return row

    def _on_row_click(self, event, item: BookmarkItem):
        if event.button() == Qt.LeftButton:
            if item.is_folder:
                # Open sub-dropdown beside this row
                sender_widget = self.sender() if hasattr(self, 'sender') else None
                sub = FolderDropdown(item, self, self.bar)
                sub.show()
            elif item.url:
                self.bar.open_url(item.url)
                self.close()
        elif event.button() == Qt.RightButton:
            self.bar._show_context_menu(item, event.globalPos())

    def _on_row_context(self, item: BookmarkItem, pos):
        self.bar._show_context_menu(item, pos)


# ===== Main Bookmark Bar Widget =====

class BookmarkBar(QWidget):
    """The main multi-row bookmark bar overlay."""

    def __init__(self):
        super().__init__(None, Qt.WindowStaysOnTopHint | Qt.FramelessWindowHint | Qt.Tool)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setAcceptDrops(True)

        # Core state
        self.store = BookmarkStore()
        self.settings_mgr = SettingsManager()
        self.favicon_mgr = FaviconManager()
        self._active_dropdown: Optional[FolderDropdown] = None
        self._tracked_window_rect: Optional[QRect] = None

        # Main layout
        self._main_layout = QVBoxLayout(self)
        self._main_layout.setContentsMargins(0, 0, 0, 0)
        self._main_layout.setSpacing(0)

        # Background widget
        self._bg = QFrame(self)
        self._bg.setObjectName("mrbb-bg")
        self._main_layout.addWidget(self._bg)

        self._bg_layout = QVBoxLayout(self._bg)
        self._bg_layout.setContentsMargins(0, 0, 0, 0)
        self._bg_layout.setSpacing(0)

        self._apply_style()

        # Position first so _build_bar has correct width for layout calc
        self._position_default()
        self._build_bar()

        # Window tracking timer
        self._track_timer = QTimer(self)
        self._track_timer.timeout.connect(self._track_browser_window)
        if self.settings_mgr.get("autoTrack", True):
            self._track_timer.start(100)

        # System tray
        self._setup_tray()

    def _apply_style(self):
        opacity = self.settings_mgr.get("barOpacity", 0.97)
        bh = self.settings_mgr.get("barHeight", 34)
        self._bg.setStyleSheet(f"""
            #mrbb-bg {{
                background: rgba(255, 255, 255, {int(opacity * 255)});
                border-bottom: 1px solid #dadce0;
            }}
        """)

    def _build_bar(self):
        """Rebuild the entire bar from bookmarks."""
        # Clear existing rows
        while self._bg_layout.count():
            child = self._bg_layout.takeAt(0)
            if child.widget():
                child.widget().deleteLater()

        bookmarks = self.store.bookmarks
        if not bookmarks:
            # Show empty state with add button
            row = self._create_empty_row()
            self._bg_layout.addWidget(row)
            self._update_geometry()
            return

        font_size = self.settings_mgr.get("fontSize", 12)
        bar_height = self.settings_mgr.get("barHeight", 34)
        display_mode = self.settings_mgr.get("displayMode", "both")
        max_rows = self.settings_mgr.get("maxRows", 0)

        # Calculate layout
        layout = self._calc_layout(bookmarks, font_size, bar_height, display_mode)
        if not layout:
            self._update_geometry()
            return

        total_rows = max(item[1] for item in layout) + 1
        if max_rows > 0:
            total_rows = min(total_rows, max_rows)

        for r in range(total_rows):
            row_widget = QWidget()
            row_widget.setFixedHeight(bar_height)
            row_layout = QHBoxLayout(row_widget)
            row_layout.setContentsMargins(8, 0, 8, 0)
            row_layout.setSpacing(0)

            # Gear button on row 0
            if r == 0:
                gear = self._create_gear_button(bar_height)
                row_layout.addWidget(gear)

            # Items for this row
            for item, item_row in layout:
                if item_row != r:
                    continue
                w = BookmarkItemWidget(item, display_mode, font_size, bar_height, self.favicon_mgr, self)
                w.clicked.connect(self._on_item_clicked)
                w.folderHovered.connect(self._on_folder_hovered)
                w.contextMenuRequested.connect(self._show_context_menu)
                row_layout.addWidget(w)

            # Search button on row 0
            if r == 0:
                search = self._create_search_button(bar_height)
                row_layout.addWidget(search)

            row_layout.addStretch()
            self._bg_layout.addWidget(row_widget)

        self._update_geometry()

    def _calc_layout(self, bookmarks: List[BookmarkItem], font_size: int,
                     bar_height: int, display_mode: str) -> List[tuple]:
        """Calculate which items go on which row. Returns [(BookmarkItem, row_index)]."""
        result = []
        if not bookmarks:
            return result

        avail_w = self.width() - 16 if self.width() > 100 else 800
        gear_w = 28
        search_w = 28
        max_rows = self.settings_mgr.get("maxRows", 0)
        current_row = 0
        row_used = 0
        font = QFont("Segoe UI", font_size)
        fm = QFontMetrics(font)

        for bm in bookmarks:
            item_w = 16  # padding
            if display_mode != "text_only":
                item_w += 16
            if display_mode != "icon_only" and bm.title:
                if display_mode != "text_only":
                    item_w += 6
                item_w += min(fm.horizontalAdvance(bm.title), 150)
            item_w = max(int(item_w), 24)

            effective = avail_w - gear_w - search_w if current_row == 0 else avail_w
            if row_used + item_w > effective and row_used > 0:
                current_row += 1
                row_used = 0
                if max_rows > 0 and current_row >= max_rows:
                    break
                effective = avail_w - gear_w - search_w if current_row == 0 else avail_w

            result.append((bm, current_row))
            row_used += item_w

        return result

    def _create_empty_row(self) -> QWidget:
        row = QWidget()
        row.setFixedHeight(self.settings_mgr.get("barHeight", 34))
        h = QHBoxLayout(row)
        h.setContentsMargins(8, 0, 8, 0)

        gear = self._create_gear_button(row.height())
        h.addWidget(gear)

        label = QLabel("右クリックでブックマークを追加 →")
        label.setStyleSheet("color: #9aa0a6; font-size: 12px;")
        h.addWidget(label)
        h.addStretch()
        return row

    def _create_gear_button(self, height: int) -> QPushButton:
        btn = QPushButton("⚙")
        btn.setFixedSize(24, max(height - 6, 16))
        btn.setCursor(Qt.PointingHandCursor)
        btn.setStyleSheet("""
            QPushButton {
                background: transparent; border: none; font-size: 14px; color: #5f6368;
                border-radius: 4px;
            }
            QPushButton:hover { background: rgba(0,0,0,0.08); }
        """)
        btn.clicked.connect(self._show_settings)
        return btn

    def _create_search_button(self, height: int) -> QPushButton:
        btn = QPushButton("🔍")
        btn.setFixedSize(24, max(height - 6, 16))
        btn.setCursor(Qt.PointingHandCursor)
        btn.setStyleSheet("""
            QPushButton {
                background: transparent; border: none; font-size: 12px; color: #5f6368;
                border-radius: 4px;
            }
            QPushButton:hover { background: rgba(0,0,0,0.08); }
        """)
        btn.clicked.connect(self._show_search)
        return btn

    def _update_geometry(self):
        """Update window size based on content."""
        bar_height = self.settings_mgr.get("barHeight", 34)
        row_count = self._bg_layout.count()
        if row_count == 0:
            row_count = 1
        total_h = row_count * bar_height
        self.setFixedHeight(total_h + 1)  # +1 for border

    def _position_default(self):
        """Set default position at top of primary screen."""
        screen = QApplication.primaryScreen().availableGeometry()
        self.setGeometry(screen.x(), screen.y(), screen.width(), self.height())

    # ===== Actions =====

    def open_url(self, url: str):
        """Open URL in the default/configured browser."""
        try:
            target = self.settings_mgr.get("targetBrowser", "auto")
            if target == "auto" or not target:
                import webbrowser
                webbrowser.open(url)
            elif target == "custom":
                custom_path = self.settings_mgr.get("customBrowserPath", "")
                if custom_path:
                    subprocess.Popen([custom_path, url])
                else:
                    import webbrowser
                    webbrowser.open(url)
            else:
                # Try to find browser executable
                browser_map = {
                    "chrome": ["google-chrome", "chrome", "chromium"],
                    "edge": ["msedge", "microsoft-edge"],
                    "firefox": ["firefox"],
                }
                names = browser_map.get(target, [target])
                if platform.system() == "Windows":
                    for name in names:
                        try:
                            subprocess.Popen([name, url])
                            return
                        except FileNotFoundError:
                            continue
                import webbrowser
                webbrowser.open(url)
        except Exception as e:
            print(f"[MRBB] Failed to open URL: {e}")

    def _on_item_clicked(self, url_or_id: str):
        if url_or_id.startswith("http") or url_or_id.startswith("file:"):
            self.open_url(url_or_id)
        else:
            # Folder click — find the folder and its anchor widget
            folder = self.store._find_by_id(url_or_id)
            if folder and folder.is_folder:
                # Find the BookmarkItemWidget for this folder
                sender = self.sender()
                if isinstance(sender, BookmarkItemWidget):
                    self._open_folder_dropdown(folder, sender)

    def _on_folder_hovered(self, folder: BookmarkItem, widget: BookmarkItemWidget):
        if self.settings_mgr.get("folderOpenMode", "hover") == "hover":
            self._open_folder_dropdown(folder, widget)

    def _open_folder_dropdown(self, folder: BookmarkItem, anchor: QWidget):
        if self._active_dropdown:
            self._active_dropdown.close()
            self._active_dropdown = None
        dd = FolderDropdown(folder, anchor, self)
        dd.show()
        self._active_dropdown = dd

    # ===== Context Menu =====

    def _show_context_menu(self, item_or_none, pos):
        menu = QMenu(self)
        menu.setStyleSheet("""
            QMenu {
                background: white; border: 1px solid #dadce0; border-radius: 8px;
                padding: 4px 0; font-family: "Segoe UI"; font-size: 12px;
            }
            QMenu::item { padding: 6px 24px; }
            QMenu::item:selected { background: #f1f3f4; }
            QMenu::separator { height: 1px; background: #e8eaed; margin: 4px 0; }
        """)

        if isinstance(item_or_none, BookmarkItem):
            item = item_or_none
            if not item.is_folder and item.url:
                act = menu.addAction("新しいタブで開く")
                act.triggered.connect(lambda: self.open_url(item.url))
                menu.addSeparator()

            if item.is_folder:
                act = menu.addAction("全てタブで開く")
                act.triggered.connect(lambda: self._open_all_in_tabs(item))
                menu.addSeparator()

            act = menu.addAction("名前を変更")
            act.triggered.connect(lambda: self._rename_item(item))

            if not item.is_folder:
                act = menu.addAction("URLを編集")
                act.triggered.connect(lambda: self._edit_url(item))

            menu.addSeparator()
            act = menu.addAction("削除")
            act.triggered.connect(lambda: self._delete_item(item))
            menu.addSeparator()

        # Common actions
        act = menu.addAction("ページを追加...")
        act.triggered.connect(lambda: self._add_bookmark_dialog(
            item_or_none.id if isinstance(item_or_none, BookmarkItem) and item_or_none.is_folder else ""))

        act = menu.addAction("フォルダを追加...")
        act.triggered.connect(lambda: self._add_folder_dialog(
            item_or_none.id if isinstance(item_or_none, BookmarkItem) and item_or_none.is_folder else ""))

        menu.exec_(pos)

    def contextMenuEvent(self, event):
        self._show_context_menu(None, event.globalPos())

    def _add_bookmark_dialog(self, parent_id: str = ""):
        title, ok1 = QInputDialog.getText(self, "ブックマーク追加", "名前:")
        if not ok1 or not title:
            return
        url, ok2 = QInputDialog.getText(self, "ブックマーク追加", "URL:", text="https://")
        if ok2 and url:
            self.store.add_bookmark(title, url, parent_id)
            self._build_bar()

    def _add_folder_dialog(self, parent_id: str = ""):
        title, ok = QInputDialog.getText(self, "フォルダ追加", "フォルダ名:")
        if ok and title.strip():
            self.store.add_folder(title.strip(), parent_id)
            self._build_bar()

    def _rename_item(self, item: BookmarkItem):
        new_name, ok = QInputDialog.getText(self, "名前を変更", "新しい名前:", text=item.title)
        if ok and new_name:
            self.store.update_item(item.id, title=new_name)
            self._build_bar()

    def _edit_url(self, item: BookmarkItem):
        new_url, ok = QInputDialog.getText(self, "URLを編集", "新しいURL:", text=item.url)
        if ok and new_url:
            self.store.update_item(item.id, url=new_url)
            self._build_bar()

    def _delete_item(self, item: BookmarkItem):
        self.store.delete_item(item.id)
        self._build_bar()

    def _open_all_in_tabs(self, folder: BookmarkItem):
        for child in folder.children:
            if not child.is_folder and child.url:
                self.open_url(child.url)

    def _move_item_to_folder(self, source_id: str, folder_id: str):
        self.store.move_item(source_id, folder_id)
        self._build_bar()

    def _move_item_before(self, source_id: str, target_id: str):
        # Find target's index in its parent
        for i, bm in enumerate(self.store.bookmarks):
            if bm.id == target_id:
                self.store.move_item(source_id, "", i)
                self._build_bar()
                return
        # Search in subfolders (simplified — top-level only for now)
        self.store.move_item(source_id, "", -1)
        self._build_bar()

    # ===== Search =====

    def _show_search(self):
        query, ok = QInputDialog.getText(self, "ブックマーク検索", "検索:")
        if not ok or not query:
            return
        results = self._search_bookmarks(query.lower(), self.store.bookmarks)
        if not results:
            QMessageBox.information(self, "検索結果", "見つかりませんでした。")
            return
        menu = QMenu(self)
        menu.setStyleSheet("""
            QMenu { background: white; border: 1px solid #dadce0; border-radius: 8px; padding: 4px 0; }
            QMenu::item { padding: 6px 16px; font-size: 12px; }
            QMenu::item:selected { background: #f1f3f4; }
        """)
        for item in results[:20]:
            act = menu.addAction(f"{item.title} — {item.url[:50]}")
            act.triggered.connect(lambda checked, u=item.url: self.open_url(u))
        menu.exec_(QCursor.pos())

    def _search_bookmarks(self, query: str, items: List[BookmarkItem]) -> List[BookmarkItem]:
        results = []
        for item in items:
            if not item.is_folder and (query in item.title.lower() or query in item.url.lower()):
                results.append(item)
            if item.is_folder:
                results.extend(self._search_bookmarks(query, item.children))
        return results

    # ===== Settings =====

    def _show_settings(self):
        dlg = QDialog(self)
        dlg.setWindowTitle("Multi-Row Bookmark Bar 設定")
        dlg.setFixedWidth(350)
        form = QFormLayout(dlg)

        # Font size
        fs_spin = QSpinBox()
        fs_spin.setRange(8, 20)
        fs_spin.setValue(self.settings_mgr.get("fontSize", 12))
        form.addRow("フォントサイズ:", fs_spin)

        # Bar height
        bh_spin = QSpinBox()
        bh_spin.setRange(20, 60)
        bh_spin.setValue(self.settings_mgr.get("barHeight", 34))
        form.addRow("行の高さ:", bh_spin)

        # Max rows
        mr_spin = QSpinBox()
        mr_spin.setRange(0, 20)
        mr_spin.setValue(self.settings_mgr.get("maxRows", 0))
        mr_spin.setSpecialValueText("無制限")
        form.addRow("最大行数:", mr_spin)

        # Display mode
        dm_combo = QComboBox()
        dm_combo.addItems(["Icon + Text", "Icon only", "Text only"])
        dm_map = {"both": 0, "icon_only": 1, "text_only": 2}
        dm_combo.setCurrentIndex(dm_map.get(self.settings_mgr.get("displayMode", "both"), 0))
        form.addRow("表示モード:", dm_combo)

        # Folder open mode
        fo_combo = QComboBox()
        fo_combo.addItems(["Hover", "Click"])
        fo_combo.setCurrentIndex(0 if self.settings_mgr.get("folderOpenMode", "hover") == "hover" else 1)
        form.addRow("フォルダを開く:", fo_combo)

        # Target browser
        tb_combo = QComboBox()
        tb_combo.addItems(["自動", "Chrome", "Edge", "Firefox", "カスタム"])
        tb_map = {"auto": 0, "chrome": 1, "edge": 2, "firefox": 3, "custom": 4}
        tb_combo.setCurrentIndex(tb_map.get(self.settings_mgr.get("targetBrowser", "auto"), 0))
        form.addRow("ブラウザ:", tb_combo)

        # Auto track
        track_combo = QComboBox()
        track_combo.addItems(["ON", "OFF"])
        track_combo.setCurrentIndex(0 if self.settings_mgr.get("autoTrack", True) else 1)
        form.addRow("ウィンドウ追従:", track_combo)

        # Chrome bar offset (0=auto)
        offset_spin = QSpinBox()
        offset_spin.setRange(0, 300)
        offset_spin.setValue(self.settings_mgr.get("chromeBarOffset", 0))
        offset_spin.setSpecialValueText("自動検出")
        offset_spin.setSuffix(" px")
        form.addRow("バー位置オフセット:", offset_spin)

        # Buttons
        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        buttons.accepted.connect(dlg.accept)
        buttons.rejected.connect(dlg.reject)
        form.addRow(buttons)

        if dlg.exec_() == QDialog.Accepted:
            self.settings_mgr.set("fontSize", fs_spin.value())
            self.settings_mgr.set("barHeight", bh_spin.value())
            self.settings_mgr.set("maxRows", mr_spin.value())
            dm_reverse = {0: "both", 1: "icon_only", 2: "text_only"}
            self.settings_mgr.set("displayMode", dm_reverse.get(dm_combo.currentIndex(), "both"))
            self.settings_mgr.set("folderOpenMode", "hover" if fo_combo.currentIndex() == 0 else "click")
            tb_reverse = {0: "auto", 1: "chrome", 2: "edge", 3: "firefox", 4: "custom"}
            self.settings_mgr.set("targetBrowser", tb_reverse.get(tb_combo.currentIndex(), "auto"))
            self.settings_mgr.set("autoTrack", track_combo.currentIndex() == 0)
            self.settings_mgr.set("chromeBarOffset", offset_spin.value())

            if self.settings_mgr.get("autoTrack"):
                self._track_timer.start(100)
            else:
                self._track_timer.stop()

            self._apply_style()
            self._build_bar()

    # ===== Window Tracking (Win32) =====

    def _get_chrome_ui_height(self, hwnd):
        """
        Chrome UI の高さ（タブ + アドレスバー + ブックマークバー）を自動検出。
        GetClientRect と GetWindowRect の差分 + クライアント領域の先頭位置で計算。
        """
        manual = self.settings_mgr.get("chromeBarOffset", 0)
        if manual and manual > 0:
            return manual

        try:
            # ウィンドウ全体の矩形
            wr = ctypes.wintypes.RECT()
            ctypes.windll.user32.GetWindowRect(hwnd, ctypes.byref(wr))

            # クライアント領域（ページ描画部分）の左上をスクリーン座標に変換
            pt = ctypes.wintypes.POINT(0, 0)
            ctypes.windll.user32.ClientToScreen(hwnd, ctypes.byref(pt))

            # クライアント領域の先頭Y - ウィンドウの先頭Y = Chrome UI の高さ
            ui_height = pt.y - wr.top
            if ui_height > 30 and ui_height < 300:
                return ui_height
        except Exception:
            pass

        # フォールバック: Chrome 標準的な高さ
        # タイトルバー(~32) + タブバー(~34) + アドレスバー(~34) + ブックマークバー(~34) ≈ 134
        return 134

    def _track_browser_window(self):
        """Track the foreground browser window and position the bar below its UI."""
        if not HAS_WIN32 or platform.system() != "Windows":
            return

        try:
            hwnd = ctypes.windll.user32.GetForegroundWindow()
            if not hwnd:
                return

            # Get window class name to check if it's a browser
            class_name = ctypes.create_unicode_buffer(256)
            ctypes.windll.user32.GetClassNameW(hwnd, class_name, 256)
            cn = class_name.value

            # Common browser window class names
            browser_classes = [
                "Chrome_WidgetWin_1",       # Chrome / Edge
                "MozillaWindowClass",        # Firefox
                "ApplicationFrameWindow",    # UWP Edge
            ]

            if cn not in browser_classes:
                return

            # Get window rect
            rect = ctypes.wintypes.RECT()
            ctypes.windll.user32.GetWindowRect(hwnd, ctypes.byref(rect))

            # Check if window is minimized
            if ctypes.windll.user32.IsIconic(hwnd):
                return

            # ウィンドウ幅（左右の影/ボーダーを考慮）
            win_width = rect.right - rect.left

            # Chrome UI 高さを自動検出してブックマークバーの直下に配置
            ui_height = self._get_chrome_ui_height(hwnd)

            new_rect = QRect(rect.left, rect.top + ui_height, win_width, self.height())

            if self._tracked_window_rect != new_rect:
                old_width = self._tracked_window_rect.width() if self._tracked_window_rect else 0
                self._tracked_window_rect = new_rect
                self.setGeometry(new_rect.x(), new_rect.y(), new_rect.width(), self.height())
                # Rebuild layout if width changed
                if new_rect.width() != old_width:
                    self._build_bar()

        except Exception as e:
            pass  # Silently fail on tracking errors

    # ===== System Tray =====

    def _setup_tray(self):
        if not QSystemTrayIcon.isSystemTrayAvailable():
            return
        self._tray = QSystemTrayIcon(self)
        # Create a simple icon
        px = QPixmap(32, 32)
        px.fill(QColor("#1a73e8"))
        painter = QPainter(px)
        painter.setPen(QPen(Qt.white, 2))
        painter.setFont(QFont("Segoe UI", 16, QFont.Bold))
        painter.drawText(px.rect(), Qt.AlignCenter, "B")
        painter.end()
        self._tray.setIcon(QIcon(px))

        tray_menu = QMenu()
        tray_menu.addAction("表示/非表示", self._toggle_visibility)
        tray_menu.addAction("設定", self._show_settings)
        tray_menu.addSeparator()
        tray_menu.addAction("終了", QApplication.quit)
        self._tray.setContextMenu(tray_menu)
        self._tray.activated.connect(self._on_tray_activated)
        self._tray.show()

    def _toggle_visibility(self):
        if self.isVisible():
            self.hide()
        else:
            self.show()

    def _on_tray_activated(self, reason):
        if reason == QSystemTrayIcon.DoubleClick:
            self._toggle_visibility()

    # ===== Drag & Drop on bar itself =====

    def dragEnterEvent(self, event):
        mime = event.mimeData()
        # 内部D&D（並び替え）
        if mime.hasFormat("application/x-mrbb-id"):
            event.acceptProposedAction()
            return
        # 外部D&D: ChromeからのURL/テキスト/リンク
        if mime.hasUrls() or mime.hasText() or mime.hasFormat("text/uri-list"):
            event.setDropAction(Qt.CopyAction)
            event.accept()
            return

    def dragMoveEvent(self, event):
        mime = event.mimeData()
        if mime.hasFormat("application/x-mrbb-id") or mime.hasUrls() or mime.hasText():
            event.accept()

    def dropEvent(self, event):
        mime = event.mimeData()

        # 内部D&D（並び替え）
        if mime.hasFormat("application/x-mrbb-id"):
            source_id = bytes(mime.data("application/x-mrbb-id")).decode()
            if source_id:
                self.store.move_item(source_id, "", -1)
                self._build_bar()
            return

        # 外部D&D: ChromeのアドレスバーやブックマークバーからドラッグされたURL
        urls = []
        title = ""

        # 1. URL リストから取得（Chrome は text/uri-list で渡してくる）
        if mime.hasUrls():
            for qurl in mime.urls():
                u = qurl.toString()
                if u and (u.startswith("http") or u.startswith("file:")):
                    urls.append(u)

        # 2. テキストからURLを抽出（アドレスバーからのドラッグなど）
        if not urls and mime.hasText():
            text = mime.text().strip()
            # 複数行の場合: 1行目=タイトル、2行目=URL のパターン（Chrome bookmark D&D）
            lines = text.split("\n")
            if len(lines) >= 2:
                candidate_url = lines[-1].strip()
                candidate_title = lines[0].strip()
                if candidate_url.startswith("http") or candidate_url.startswith("file:"):
                    urls.append(candidate_url)
                    title = candidate_title
            elif text.startswith("http") or text.startswith("file:"):
                urls.append(text)

        if not urls:
            event.ignore()
            return

        event.acceptProposedAction()

        # ドロップ位置のインデックスを計算
        drop_index = self._get_drop_index(event.pos())

        for url in urls:
            # タイトルが無ければURLのドメイン名を使う
            bm_title = title or self._extract_title_from_url(url)
            item = BookmarkItem(title=bm_title, url=url)
            if drop_index >= 0:
                self.store.bookmarks.insert(drop_index, item)
                drop_index += 1
            else:
                self.store.bookmarks.append(item)
        self.store.save()
        self._build_bar()

    def _get_drop_index(self, pos) -> int:
        """ドロップ位置からブックマーク挿入インデックスを計算"""
        # 全行を走査して、ドロップ位置に最も近いアイテムの後に挿入
        for row_idx in range(self._bg_layout.count()):
            row_widget = self._bg_layout.itemAt(row_idx).widget()
            if not row_widget:
                continue
            row_layout = row_widget.layout()
            if not row_layout:
                continue
            for i in range(row_layout.count()):
                item_widget = row_layout.itemAt(i).widget()
                if isinstance(item_widget, BookmarkItemWidget):
                    widget_rect = item_widget.geometry()
                    # 行内のグローバル位置で比較
                    widget_global = row_widget.mapToParent(widget_rect.center())
                    if pos.x() < widget_global.x():
                        # このアイテムの前に挿入
                        bm_id = item_widget.item.id
                        for idx, bm in enumerate(self.store.bookmarks):
                            if bm.id == bm_id:
                                return idx
        return -1  # 末尾

    @staticmethod
    def _extract_title_from_url(url: str) -> str:
        """URLからタイトルを抽出（ドメイン名 or パス）"""
        try:
            qurl = QUrl(url)
            host = qurl.host()
            if host:
                # www. を除去、ドメイン名をタイトル化
                host = host.replace("www.", "")
                parts = host.split(".")
                if len(parts) >= 2:
                    return parts[0].capitalize()
                return host
            return url[:40]
        except Exception:
            return url[:40]

    # ===== Keyboard shortcut =====

    def keyPressEvent(self, event):
        if event.modifiers() == (Qt.ControlModifier | Qt.ShiftModifier) and event.key() == Qt.Key_B:
            self._toggle_visibility()
        super().keyPressEvent(event)


# ===== Entry Point =====

def main():
    app = QApplication(sys.argv)
    app.setApplicationName(APP_NAME)
    app.setApplicationVersion(APP_VERSION)
    app.setQuitOnLastWindowClosed(False)  # Keep running in tray

    bar = BookmarkBar()
    bar.show()

    sys.exit(app.exec_())


if __name__ == "__main__":
    main()
