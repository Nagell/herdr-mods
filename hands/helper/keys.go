package main

// keys.go parses chords like cmd+shift+s into a US-layout virtual keycode
// and CGEvent modifier flags.

import (
	"fmt"
	"strings"
)

const (
	flagShift   = 1 << 17
	flagControl = 1 << 18
	flagOption  = 1 << 19
	flagCommand = 1 << 20
	flagFn      = 1 << 23
)

var modifiers = map[string]uint64{
	"cmd": flagCommand, "command": flagCommand, "meta": flagCommand, "super": flagCommand,
	"shift": flagShift, "ctrl": flagControl, "control": flagControl,
	"alt": flagOption, "opt": flagOption, "option": flagOption, "fn": flagFn,
}

var keycodes = map[string]int{
	"a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13,
	"e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25,
	"7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35, "l": 37, "j": 38,
	"'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "`": 50,
	"enter": 36, "return": 36, "tab": 48, "space": 49, "backspace": 51, "delete": 51, "esc": 53, "escape": 53,
	"forwarddelete": 117, "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
	"left": 123, "right": 124, "down": 125, "up": 126,
	"f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98, "f8": 100, "f9": 101, "f10": 109,
	"f11": 103, "f12": 111, "f13": 105, "f14": 107, "f15": 113,
}

// Shifted characters on a US keyboard, by the key that produces them.
var shifted = map[rune]string{
	'!': "1", '@': "2", '#': "3", '$': "4", '%': "5", '^': "6", '&': "7", '*': "8", '(': "9", ')': "0",
	'_': "-", '+': "=", '{': "[", '}': "]", '|': "\\", ':': ";", '"': "'", '<': ",", '>': ".", '?': "/", '~': "`",
}

// keystroke maps one character to a keycode and flags; ok is false for
// characters outside the US layout, which are sent as Unicode text instead.
func keystroke(r rune) (code int, flags uint64, ok bool) {
	switch r {
	case '\n':
		return keycodes["enter"], 0, true
	case '\t':
		return keycodes["tab"], 0, true
	case ' ':
		return keycodes["space"], 0, true
	}
	if r >= 'A' && r <= 'Z' {
		return keycodes[string(r+32)], flagShift, true
	}
	if key, isShifted := shifted[r]; isShifted {
		return keycodes[key], flagShift, true
	}
	code, ok = keycodes[string(r)]
	return code, 0, ok
}

func parseChord(chord string) (int, uint64, error) {
	parts := strings.Split(strings.ToLower(strings.TrimSpace(chord)), "+")
	var flags uint64
	key := ""
	for i, part := range parts {
		part = strings.TrimSpace(part)
		if flag, ok := modifiers[part]; ok && i < len(parts)-1 {
			flags |= flag
			continue
		}
		if key != "" {
			return 0, 0, fmt.Errorf("one key per chord: %q", chord)
		}
		key = part
	}
	code, ok := keycodes[key]
	if !ok {
		return 0, 0, fmt.Errorf("unknown key %q; use a letter, digit, punctuation, enter, tab, space, esc, backspace, arrows, home/end, page keys or f1–f15", key)
	}
	// Arrow and function keys carry the fn flag like a real keyboard does.
	if code >= 96 {
		flags |= flagFn
	}
	return code, flags, nil
}
