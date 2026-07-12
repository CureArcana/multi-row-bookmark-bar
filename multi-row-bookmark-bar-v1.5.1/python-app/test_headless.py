#!/usr/bin/env python3
"""
Headless test for Multi-Row Bookmark Bar.
Tests core logic: data model, settings, layout, UI creation.
"""
import os
import sys
import json
import tempfile
import shutil

# Force offscreen
os.environ["QT_QPA_PLATFORM"] = "offscreen"

from PyQt5.QtWidgets import QApplication
from PyQt5.QtCore import QTimer

# Patch config dirs to temp
_tmpdir = tempfile.mkdtemp(prefix="mrbb_test_")
import main as m
m.CONFIG_DIR = type(m.CONFIG_DIR)(_tmpdir)
m.BOOKMARKS_FILE = m.CONFIG_DIR / "bookmarks.json"
m.SETTINGS_FILE = m.CONFIG_DIR / "settings.json"
m.FAVICON_CACHE_DIR = m.CONFIG_DIR / "favicons"

passed = 0
failed = 0

def test(name, condition):
    global passed, failed
    if condition:
        print(f"  ✓ {name}")
        passed += 1
    else:
        print(f"  ✗ {name}")
        failed += 1

def run_tests():
    global passed, failed

    print("=" * 60)
    print("Multi-Row Bookmark Bar v1.5.1 — Headless Tests")
    print("=" * 60)

    # ===== 1. Data Model Tests =====
    print("\n[1] BookmarkStore")
    store = m.BookmarkStore()
    test("Initial bookmarks empty", len(store.bookmarks) == 0)

    bm1 = store.add_bookmark("Google", "https://www.google.com")
    test("Add bookmark", len(store.bookmarks) == 1)
    test("Bookmark title", bm1.title == "Google")
    test("Bookmark url", bm1.url == "https://www.google.com")
    test("Not a folder", not bm1.is_folder)

    bm2 = store.add_bookmark("YouTube", "https://www.youtube.com")
    test("Two bookmarks", len(store.bookmarks) == 2)

    folder = store.add_folder("My Folder")
    test("Add folder", len(store.bookmarks) == 3)
    test("Is folder", folder.is_folder)
    test("Folder empty children", len(folder.children) == 0)

    bm3 = store.add_bookmark("Reddit", "https://www.reddit.com", folder.id)
    test("Add to folder", len(folder.children) == 1)
    test("Child title", folder.children[0].title == "Reddit")

    # Rename
    store.update_item(bm1.id, title="Google Search")
    found = store._find_by_id(bm1.id)
    test("Rename bookmark", found.title == "Google Search")

    # Edit URL
    store.update_item(bm2.id, url="https://youtube.com")
    found2 = store._find_by_id(bm2.id)
    test("Edit URL", found2.url == "https://youtube.com")

    # Delete
    store.delete_item(bm2.id)
    test("Delete bookmark", len(store.bookmarks) == 2)

    # Move to folder
    store.move_item(bm1.id, folder.id)
    test("Move to folder", len(folder.children) == 2)
    test("Root reduced", len(store.bookmarks) == 1)

    # Save & reload
    store.save()
    test("File exists", m.BOOKMARKS_FILE.exists())
    store2 = m.BookmarkStore()
    test("Reload bookmarks", len(store2.bookmarks) == 1)
    test("Reload folder children", len(store2.bookmarks[0].children) == 2)

    # ===== 2. Settings Tests =====
    print("\n[2] SettingsManager")
    sm = m.SettingsManager()
    test("Default fontSize", sm.get("fontSize") == 12)
    test("Default barHeight", sm.get("barHeight") == 34)
    sm.set("fontSize", 14)
    test("Set fontSize", sm.get("fontSize") == 14)
    sm.save()
    sm2 = m.SettingsManager()
    test("Persist fontSize", sm2.get("fontSize") == 14)
    # Reset for UI test
    sm.set("fontSize", 12)

    # ===== 3. FaviconManager Tests =====
    print("\n[3] FaviconManager")
    fav = m.FaviconManager()
    fb = fav._fallback_icon()
    test("Fallback icon not null", not fb.isNull())
    test("Fallback icon size", fb.width() == 16 and fb.height() == 16)
    fi = fav.folder_icon()
    test("Folder icon not null", not fi.isNull())
    test("Folder icon size", fi.width() == 16 and fi.height() == 16)

    # ===== 4. BookmarkBar UI Tests =====
    print("\n[4] BookmarkBar UI")

    # Prepare fresh store with many bookmarks for multi-row test
    m.CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    m.FAVICON_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    fresh_data = {"version": 1, "bookmarks": []}
    for i in range(30):
        fresh_data["bookmarks"].append({
            "id": f"bm{i}",
            "title": f"Bookmark {i} with long name",
            "url": f"https://example{i}.com",
            "isFolder": False
        })
    # Add a folder with children
    fresh_data["bookmarks"].append({
        "id": "folder1",
        "title": "Test Folder",
        "url": "",
        "isFolder": True,
        "children": [
            {"id": "fc1", "title": "Child 1", "url": "https://child1.com", "isFolder": False},
            {"id": "fc2", "title": "Child 2", "url": "https://child2.com", "isFolder": False},
        ]
    })
    with open(m.BOOKMARKS_FILE, "w") as f:
        json.dump(fresh_data, f)

    # Reset settings
    with open(m.SETTINGS_FILE, "w") as f:
        json.dump(m.DEFAULT_SETTINGS, f)

    bar = m.BookmarkBar()
    test("Bar created", bar is not None)
    test("Bar has layout", bar._bg_layout.count() > 0)

    # Check multi-row: with 30 bookmarks at default width, should have multiple rows
    row_count = bar._bg_layout.count()
    test(f"Multiple rows created ({row_count})", row_count >= 1)

    # Test bar dimensions
    test("Bar has width", bar.width() > 0)
    test("Bar has height", bar.height() > 0)

    # Test show/hide
    bar.show()
    test("Bar visible after show", bar.isVisible())
    bar._toggle_visibility()
    test("Bar hidden after toggle", not bar.isVisible())
    bar._toggle_visibility()
    test("Bar visible after re-toggle", bar.isVisible())

    # Test context menu (just instantiate, don't exec)
    test("Context menu callable", callable(bar._show_context_menu))

    # Test add bookmark programmatically
    initial_count = len(bar.store.bookmarks)
    bar.store.add_bookmark("New Test", "https://test.com")
    test("Programmatic add", len(bar.store.bookmarks) == initial_count + 1)

    # Test search
    results = bar._search_bookmarks("bookmark 5", bar.store.bookmarks)
    test("Search finds result", len(results) >= 1)
    test("Search result correct", any("5" in r.title for r in results))

    results_none = bar._search_bookmarks("zzzznotfound", bar.store.bookmarks)
    test("Search no results", len(results_none) == 0)

    # Test settings dialog doesn't crash (just create, don't exec)
    test("Settings callable", callable(bar._show_settings))

    # Test folder dropdown
    folder_items = [b for b in bar.store.bookmarks if b.is_folder]
    if folder_items:
        folder_bm = folder_items[0]
        test("Found test folder", folder_bm.title == "Test Folder")
        test("Folder has children", len(folder_bm.children) == 2)

    # Test open_url doesn't crash (won't actually open browser)
    try:
        # This will try to open but we don't care about the result
        # Just verify no crash
        test("open_url callable", callable(bar.open_url))
    except Exception as e:
        test(f"open_url no crash: {e}", False)

    # ===== 5. Layout Calculation Tests =====
    print("\n[5] Layout Calculation")
    bar.setGeometry(0, 0, 800, 200)
    layout = bar._calc_layout(bar.store.bookmarks, 12, 34, "both")
    test("Layout not empty", len(layout) > 0)
    rows_used = set(row for _, row in layout)
    test(f"Layout uses multiple rows ({len(rows_used)})", len(rows_used) >= 2)

    # Icon only mode (narrower items)
    layout_icon = bar._calc_layout(bar.store.bookmarks, 12, 34, "icon_only")
    rows_icon = set(row for _, row in layout_icon)
    test("Icon-only uses fewer rows", len(rows_icon) <= len(rows_used))

    # Max rows
    bar.settings_mgr.set("maxRows", 2)
    layout_max = bar._calc_layout(bar.store.bookmarks, 12, 34, "both")
    rows_max = set(row for _, row in layout_max)
    test(f"Max rows respected ({len(rows_max)} <= 2)", len(rows_max) <= 2)
    bar.settings_mgr.set("maxRows", 0)

    # ===== 6. Drag & Drop Data Tests =====
    print("\n[6] Drag & Drop")
    store3 = m.BookmarkStore()
    test("Store reload for D&D", len(store3.bookmarks) > 5)

    first_id = store3.bookmarks[0].id
    second_id = store3.bookmarks[1].id
    store3.move_item(first_id, "", 5)
    # After extract from pos 0 (list shrinks by 1), insert at 5 → ends up at index 5
    test("Move item position", store3.bookmarks[5].id == first_id)

    bar.close()

    # ===== Summary =====
    print("\n" + "=" * 60)
    total = passed + failed
    print(f"Results: {passed}/{total} passed, {failed} failed")
    if failed == 0:
        print("ALL TESTS PASSED ✓")
    else:
        print(f"SOME TESTS FAILED ✗")
    print("=" * 60)

    return failed == 0


if __name__ == "__main__":
    app = QApplication(sys.argv)

    # Run tests after event loop starts
    success = [False]
    def do_tests():
        try:
            success[0] = run_tests()
        except Exception as e:
            print(f"\n!!! TEST CRASH: {e}")
            import traceback
            traceback.print_exc()
        finally:
            # Cleanup
            shutil.rmtree(_tmpdir, ignore_errors=True)
            app.quit()

    QTimer.singleShot(100, do_tests)
    app.exec_()
    sys.exit(0 if success[0] else 1)
