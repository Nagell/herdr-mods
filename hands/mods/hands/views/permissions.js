// The block that asks for whichever permission is missing. It goes away once both are granted.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme } from "herdr";
import { TEXT } from "./ui.js";

export const PERMISSIONS = [
  {
    key: "accessibility",
    label: "Accessibility",
    why: "Read and operate other apps",
    settings: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  },
  {
    key: "screen",
    label: "Screen Recording",
    why: "Screenshots and recordings",
    settings: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  },
];

function grantButton(permission, { asking, onAsk }, t) {
  return h_flex()
    .id(`hands-ask-${permission.key}`)
    .flex_none()
    .min_h(30)
    .px(10)
    .py(5)
    .items_center()
    .rounded(6)
    .border_1()
    .border_color(t.border)
    .bg(t.raised)
    .text_size(TEXT.caption)
    .text_color(asking ? t.dim : t.foreground)
    .accessibility_label(`Grant ${permission.label} access to Herdr`)
    .when(!asking, (el) =>
      el
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => onAsk(permission, cx)),
    )
    .child(asking === permission.key ? "Asking…" : "Grant access");
}

function permissionRow(permission, state, t) {
  const granted = Boolean(state.permissions[permission.key]);
  return h_flex()
    .id(`hands-${permission.key}`)
    .gap(8)
    .items_center()
    .child(
      div()
        .size(8)
        .flex_none()
        .rounded(4)
        .bg(granted ? t.done : t.blocked),
    )
    .child(
      v_flex()
        .flex_1()
        .min_w(0)
        .child(div().text_color(t.foreground).child(permission.label))
        .child(div().text_size(TEXT.caption).text_color(t.dim).child(permission.why)),
    )
    .child(
      granted
        ? div().text_size(TEXT.caption).text_color(t.dim).child("Granted")
        : grantButton(permission, state, t),
    );
}

export function PermissionsBlock(state) {
  const t = theme();
  return v_flex()
    .id("hands-permissions")
    .flex_none()
    .m(14)
    .mb(0)
    .p(10)
    .gap(10)
    .rounded(8)
    .border_1()
    .border_color(t.border)
    .bg(t.raised)
    .child(div().font_medium().text_color(t.foreground).child("Herdr needs permission"))
    .children(PERMISSIONS.map((permission) => permissionRow(permission, state, t)));
}
