package main

// bridge.go wraps the Objective-C functions: each returns a JSON string that
// is parsed here and freed. Errors come back as {"ok":false,"error":...}.

/*
#cgo CFLAGS: -fobjc-arc -Wno-deprecated-declarations
#cgo LDFLAGS: -framework AppKit -framework Carbon -framework ApplicationServices -framework CoreGraphics -framework ScreenCaptureKit -framework AVFoundation -framework CoreMedia -framework CoreVideo -framework ImageIO -framework UniformTypeIdentifiers -framework Foundation
#include <stdlib.h>
#include "bridge.h"
*/
import "C"

import (
	"encoding/json"
	"errors"
	"unsafe"
)

func parse(raw *C.char) (any, error) {
	defer C.free(unsafe.Pointer(raw))
	var v any
	if err := json.Unmarshal([]byte(C.GoString(raw)), &v); err != nil {
		return nil, err
	}
	if m, ok := v.(map[string]any); ok && m["ok"] == false {
		if message, _ := m["error"].(string); message != "" {
			return nil, errors.New(message)
		}
		return nil, errors.New("the action failed")
	}
	return v, nil
}

func cstr(s string) *C.char { return C.CString(s) }

func permissions(askAccessibility, askScreen bool) (any, error) {
	return parse(C.hands_permissions(C.bool(askAccessibility), C.bool(askScreen)))
}
func runningApps() (any, error)         { return parse(C.hands_apps()) }
func onScreenWindows() (any, error)     { return parse(C.hands_windows()) }
func frontmostPid() int                 { return int(C.hands_frontmost_pid()) }

func tree(pid int, window string, menus bool, maxNodes, maxDepth int) (any, error) {
	w := cstr(window)
	defer C.free(unsafe.Pointer(w))
	return parse(C.hands_tree(C.int(pid), w, C.bool(menus), C.int(maxNodes), C.int(maxDepth)))
}

func act(pid int, x, y float64, e Element, action, value string) (any, error) {
	r, t, d, a, v := cstr(e.Role), cstr(e.Title), cstr(e.Desc), cstr(action), cstr(value)
	defer C.free(unsafe.Pointer(t))
	defer C.free(unsafe.Pointer(d))
	defer C.free(unsafe.Pointer(r))
	defer C.free(unsafe.Pointer(a))
	defer C.free(unsafe.Pointer(v))
	return parse(C.hands_act(C.int(pid), C.double(x), C.double(y), r, t, d, a, v))
}

func click(pid int, x, y float64, right bool, clicks int) (any, error) {
	button := 0
	if right {
		button = 1
	}
	return parse(C.hands_click(C.int(pid), C.double(x), C.double(y), C.int(button), C.int(clicks)))
}

func typeText(pid int, text string) (any, error) {
	t := cstr(text)
	defer C.free(unsafe.Pointer(t))
	return parse(C.hands_type(C.int(pid), t))
}

func pressKey(pid int, keycode int, flags uint64) (any, error) {
	return parse(C.hands_key(C.int(pid), C.int(keycode), C.ulonglong(flags)))
}

func scroll(pid int, x, y float64, dx, dy int) (any, error) {
	return parse(C.hands_scroll(C.int(pid), C.double(x), C.double(y), C.int(dx), C.int(dy)))
}

func screenshot(pid int, window, path string) (any, error) {
	w, p := cstr(window), cstr(path)
	defer C.free(unsafe.Pointer(w))
	defer C.free(unsafe.Pointer(p))
	return parse(C.hands_shot(C.int(pid), w, p))
}

// recordWindow blocks until stopRecordingWindow is called or seconds elapse.
func recordWindow(pid int, window, path string, seconds, fps int) (any, error) {
	w, p := cstr(window), cstr(path)
	defer C.free(unsafe.Pointer(w))
	defer C.free(unsafe.Pointer(p))
	return parse(C.hands_record_window(C.int(pid), w, p, C.int(seconds), C.int(fps)))
}

func stopRecordingWindow() { C.hands_record_stop() }

func layoutKey(r rune) (code int, shift, found, available bool) {
	var c, s C.int
	var a C.bool
	found = bool(C.hands_layout_key(C.uint(r), &c, &s, &a))
	return int(c), s != 0, found, bool(a)
}
