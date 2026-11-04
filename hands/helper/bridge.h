// bridge.h: the C surface between Go and the Objective-C bridge. Every
// function returns a malloc'd JSON string that Go frees after parsing.
#ifndef HANDS_BRIDGE_H
#define HANDS_BRIDGE_H

#include <stdbool.h>

char *hands_permissions(bool ask_accessibility, bool ask_screen);
char *hands_apps(void);
char *hands_windows(void);
int hands_frontmost_pid(void);
// A flat pre-order list of accessibility elements for the app, with depth.
char *hands_tree(int pid, const char *window_title, bool menus, int max_nodes, int max_depth);
// Acts on the element at (x, y) whose role matches: action is press, set, focus.
char *hands_act(int pid, double x, double y, const char *role, const char *title, const char *desc, const char *action, const char *value);
// The key producing a character on the active layout. Returns false if it has none;
// *available is false when the layout itself cannot be read.
bool hands_layout_key(unsigned int character, int *code, int *shift, bool *available);
char *hands_click(int pid, double x, double y, int button, int clicks);
char *hands_type(int pid, const char *text);
char *hands_key(int pid, int keycode, unsigned long long flags);
char *hands_scroll(int pid, double x, double y, int dx, int dy);
char *hands_shot(int pid, const char *window_title, const char *path);
// Records one window until hands_record_stop is called or seconds elapse. Blocks.
char *hands_record_window(int pid, const char *window_title, const char *path, int seconds, int fps);
void hands_record_stop(void);

#endif
