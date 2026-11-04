// bridge.m: macOS Accessibility, CGEvent and ScreenCaptureKit calls for the
// hands CLI. Results are JSON strings so the Go side stays plain. Events are
// posted to the target process with CGEventPostToPid, so the user's cursor and
// focus are never taken.
#import <AppKit/AppKit.h>
#import <AVFoundation/AVFoundation.h>
#import <Carbon/Carbon.h>
#import <ApplicationServices/ApplicationServices.h>
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#include <signal.h>
#include <string.h>
#include "bridge.h"

static char *dupJSON(id object) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:object options:0 error:nil];
    NSString *text = data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"{}";
    return strdup(text.UTF8String);
}

static char *failure(NSString *message) {
    return dupJSON(@{@"ok": @NO, @"error": message});
}

// ── Permissions and inventory ─────────────────────────────────────────────

char *hands_permissions(bool ask_accessibility, bool ask_screen) {
    @autoreleasepool {
        NSDictionary *options = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt: @(ask_accessibility)};
        bool accessibility = AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
        bool screen = CGPreflightScreenCaptureAccess();
        if (ask_screen && !screen) screen = CGRequestScreenCaptureAccess();
        return dupJSON(@{@"accessibility": @(accessibility), @"screen": @(screen)});
    }
}

char *hands_apps(void) {
    @autoreleasepool {
        NSMutableArray *apps = [NSMutableArray array];
        for (NSRunningApplication *app in NSWorkspace.sharedWorkspace.runningApplications) {
            if (app.activationPolicy != NSApplicationActivationPolicyRegular) continue;
            [apps addObject:@{
                @"pid": @(app.processIdentifier),
                @"name": app.localizedName ?: @"",
                @"bundle": app.bundleIdentifier ?: @"",
                @"frontmost": @(app.active),
            }];
        }
        return dupJSON(apps);
    }
}

char *hands_windows(void) {
    @autoreleasepool {
        CFArrayRef list = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID);
        NSMutableArray *windows = [NSMutableArray array];
        for (NSDictionary *info in (__bridge NSArray *)list) {
            if ([info[(id)kCGWindowLayer] intValue] != 0) continue;
            NSDictionary *bounds = info[(id)kCGWindowBounds];
            [windows addObject:@{
                @"id": info[(id)kCGWindowNumber] ?: @0,
                @"pid": info[(id)kCGWindowOwnerPID] ?: @0,
                @"app": info[(id)kCGWindowOwnerName] ?: @"",
                @"title": info[(id)kCGWindowName] ?: @"",
                @"x": bounds[@"X"] ?: @0, @"y": bounds[@"Y"] ?: @0,
                @"w": bounds[@"Width"] ?: @0, @"h": bounds[@"Height"] ?: @0,
            }];
        }
        if (list) CFRelease(list);
        return dupJSON(windows);
    }
}

int hands_frontmost_pid(void) {
    @autoreleasepool {
        return NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier;
    }
}

// ── Accessibility tree ────────────────────────────────────────────────────

static NSString *attributeString(AXUIElementRef element, CFStringRef attribute) {
    CFTypeRef value = NULL;
    if (AXUIElementCopyAttributeValue(element, attribute, &value) != kAXErrorSuccess || !value) return @"";
    NSString *result = @"";
    CFTypeID type = CFGetTypeID(value);
    if (type == CFStringGetTypeID()) result = [(__bridge NSString *)value copy];
    else if (type == CFNumberGetTypeID() || type == CFBooleanGetTypeID()) result = [(__bridge NSNumber *)value stringValue];
    else if (type == CFAttributedStringGetTypeID()) result = [(__bridge NSAttributedString *)value string];
    CFRelease(value);
    if (result.length > 200) result = [[result substringToIndex:200] stringByAppendingString:@"…"];
    return result;
}

static bool attributeBool(AXUIElementRef element, CFStringRef attribute, bool fallback) {
    CFTypeRef value = NULL;
    if (AXUIElementCopyAttributeValue(element, attribute, &value) != kAXErrorSuccess || !value) return fallback;
    bool result = CFGetTypeID(value) == CFBooleanGetTypeID() ? CFBooleanGetValue(value) : fallback;
    CFRelease(value);
    return result;
}

static CGRect elementFrame(AXUIElementRef element) {
    CGPoint origin = CGPointZero;
    CGSize size = CGSizeZero;
    CFTypeRef value = NULL;
    if (AXUIElementCopyAttributeValue(element, kAXPositionAttribute, &value) == kAXErrorSuccess && value) {
        AXValueGetValue(value, kAXValueTypeCGPoint, &origin);
        CFRelease(value);
    }
    value = NULL;
    if (AXUIElementCopyAttributeValue(element, kAXSizeAttribute, &value) == kAXErrorSuccess && value) {
        AXValueGetValue(value, kAXValueTypeCGSize, &size);
        CFRelease(value);
    }
    return CGRectMake(origin.x, origin.y, size.width, size.height);
}

static void walk(AXUIElementRef element, int depth, int maxDepth, int maxNodes, bool menus, NSMutableArray *out) {
    if ((int)out.count >= maxNodes || depth > maxDepth) return;
    NSString *role = attributeString(element, kAXRoleAttribute);
    if (!menus && [role isEqualToString:@"AXMenuBar"]) return;
    CGRect frame = elementFrame(element);
    [out addObject:@{
        @"d": @(depth),
        @"role": role,
        @"subrole": attributeString(element, kAXSubroleAttribute),
        @"title": attributeString(element, kAXTitleAttribute),
        @"desc": attributeString(element, kAXDescriptionAttribute),
        @"value": attributeString(element, kAXValueAttribute),
        @"placeholder": attributeString(element, kAXPlaceholderValueAttribute),
        @"x": @(frame.origin.x), @"y": @(frame.origin.y), @"w": @(frame.size.width), @"h": @(frame.size.height),
        @"enabled": @(attributeBool(element, kAXEnabledAttribute, true)),
        @"focused": @(attributeBool(element, kAXFocusedAttribute, false)),
    }];
    CFTypeRef children = NULL;
    if (AXUIElementCopyAttributeValue(element, kAXChildrenAttribute, &children) != kAXErrorSuccess || !children) return;
    for (id child in (__bridge NSArray *)children) walk((__bridge AXUIElementRef)child, depth + 1, maxDepth, maxNodes, menus, out);
    CFRelease(children);
}

char *hands_tree(int pid, const char *window_title, bool menus, int max_nodes, int max_depth) {
    @autoreleasepool {
        if (!AXIsProcessTrusted()) return failure(@"Accessibility access is not granted. Run `hands permissions --ask` and allow Herdr in System Settings › Privacy & Security › Accessibility.");
        AXUIElementRef app = AXUIElementCreateApplication(pid);
        NSMutableArray *out = [NSMutableArray array];
        NSString *wanted = window_title && *window_title ? [NSString stringWithUTF8String:window_title] : nil;
        if (wanted) {
            CFTypeRef windows = NULL;
            AXUIElementCopyAttributeValue(app, kAXWindowsAttribute, &windows);
            bool found = false;
            for (id w in (__bridge NSArray *)windows) {
                AXUIElementRef window = (__bridge AXUIElementRef)w;
                if ([attributeString(window, kAXTitleAttribute).lowercaseString containsString:wanted.lowercaseString]) {
                    walk(window, 0, max_depth, max_nodes, menus, out);
                    found = true;
                    break;
                }
            }
            if (windows) CFRelease(windows);
            CFRelease(app);
            if (!found) return failure([NSString stringWithFormat:@"No window of pid %d has a title containing %@. Run `hands windows` to list them.", pid, wanted]);
        } else {
            walk(app, 0, max_depth, max_nodes, menus, out);
            CFRelease(app);
        }
        if (out.count == 0) return failure(@"The app exposes no accessibility elements. If it just launched, retry; some apps need Accessibility access to be granted before they were started.");
        return dupJSON(out);
    }
}

// ── Acting ────────────────────────────────────────────────────────────────

// The app's topmost on-screen window containing the point, or 0.
static uint32_t windowAt(int pid, CGPoint point) {
    CFArrayRef list = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID);
    uint32_t found = 0;
    for (NSDictionary *info in (__bridge NSArray *)list) {
        if ([info[(id)kCGWindowOwnerPID] intValue] != pid || [info[(id)kCGWindowLayer] intValue] != 0) continue;
        CGRect bounds;
        if (!CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)info[(id)kCGWindowBounds], &bounds)) continue;
        if (CGRectContainsPoint(bounds, point)) { found = [info[(id)kCGWindowNumber] unsignedIntValue]; break; }
    }
    if (list) CFRelease(list);
    return found;
}

// Without Accessibility, or with the app gone, macOS drops posted events silently.
static char *inputProblem(int pid) {
    if (!AXIsProcessTrusted()) return failure(@"Accessibility access is not granted. Run `hands permissions --ask`.");
    if (pid <= 0 || kill(pid, 0) != 0) return failure([NSString stringWithFormat:@"No running process with pid %d; the app may have quit. Run `hands apps`.", pid]);
    return NULL;
}

static void postMouse(int pid, CGEventType type, CGPoint point, CGMouseButton button, int clicks) {
    CGEventRef event = CGEventCreateMouseEvent(NULL, type, point, button);
    CGEventSetIntegerValueField(event, kCGMouseEventClickState, clicks);
    // An event posted to a process still needs the window it lands in; without
    // these fields some apps, Finder among them, drop it.
    uint32_t window = windowAt(pid, point);
    if (window) {
        CGEventSetIntegerValueField(event, kCGMouseEventWindowUnderMousePointer, window);
        CGEventSetIntegerValueField(event, kCGMouseEventWindowUnderMousePointerThatCanHandleThisEvent, window);
    }
    CGEventPostToPid(pid, event);
    CFRelease(event);
}

char *hands_click(int pid, double x, double y, int button, int clicks) {
    @autoreleasepool {
        char *problem = inputProblem(pid);
        if (problem) return problem;
        CGPoint point = CGPointMake(x, y);
        CGMouseButton mouseButton = button == 1 ? kCGMouseButtonRight : kCGMouseButtonLeft;
        CGEventType down = button == 1 ? kCGEventRightMouseDown : kCGEventLeftMouseDown;
        CGEventType up = button == 1 ? kCGEventRightMouseUp : kCGEventLeftMouseUp;
        postMouse(pid, kCGEventMouseMoved, point, mouseButton, 0);
        for (int i = 1; i <= clicks; i++) {
            postMouse(pid, down, point, mouseButton, i);
            postMouse(pid, up, point, mouseButton, i);
        }
        return dupJSON(@{@"ok": @YES, @"via": @"mouse", @"x": @(x), @"y": @(y)});
    }
}

static void sendUnicode(int pid, NSString *text) {
    // Unicode strings go in chunks: the event field holds a short string.
    NSUInteger length = text.length;
    for (NSUInteger start = 0; start < length; start += 20) {
        NSRange range = NSMakeRange(start, MIN(20, length - start));
        unichar buffer[20];
        [text getCharacters:buffer range:range];
        CGEventRef down = CGEventCreateKeyboardEvent(NULL, 0, true);
        CGEventKeyboardSetUnicodeString(down, range.length, buffer);
        CGEventPostToPid(pid, down);
        CFRelease(down);
        CGEventRef up = CGEventCreateKeyboardEvent(NULL, 0, false);
        CGEventKeyboardSetUnicodeString(up, range.length, buffer);
        CGEventPostToPid(pid, up);
        CFRelease(up);
        usleep(4000);
    }
}

char *hands_type(int pid, const char *text) {
    @autoreleasepool {
        char *problem = inputProblem(pid);
        if (problem) return problem;
        sendUnicode(pid, [NSString stringWithUTF8String:text]);
        return dupJSON(@{@"ok": @YES, @"via": @"keyboard"});
    }
}

char *hands_key(int pid, int keycode, unsigned long long flags) {
    @autoreleasepool {
        char *problem = inputProblem(pid);
        if (problem) return problem;
        CGEventRef down = CGEventCreateKeyboardEvent(NULL, (CGKeyCode)keycode, true);
        CGEventSetFlags(down, (CGEventFlags)flags);
        CGEventPostToPid(pid, down);
        CFRelease(down);
        CGEventRef up = CGEventCreateKeyboardEvent(NULL, (CGKeyCode)keycode, false);
        CGEventSetFlags(up, (CGEventFlags)flags);
        CGEventPostToPid(pid, up);
        CFRelease(up);
        return dupJSON(@{@"ok": @YES, @"via": @"keyboard"});
    }
}

char *hands_scroll(int pid, double x, double y, int dx, int dy) {
    @autoreleasepool {
        char *problem = inputProblem(pid);
        if (problem) return problem;
        CGEventRef event = CGEventCreateScrollWheelEvent(NULL, kCGScrollEventUnitLine, 2, dy, dx);
        CGEventSetLocation(event, CGPointMake(x, y));
        CGEventPostToPid(pid, event);
        CFRelease(event);
        return dupJSON(@{@"ok": @YES, @"via": @"scroll"});
    }
}

// Hit-test the element's centre, then climb to the role the snapshot recorded.
static AXUIElementRef elementAt(int pid, double x, double y, NSString *role) {
    AXUIElementRef app = AXUIElementCreateApplication(pid);
    AXUIElementRef hit = NULL;
    AXError error = AXUIElementCopyElementAtPosition(app, (float)x, (float)y, &hit);
    CFRelease(app);
    if (error != kAXErrorSuccess || !hit) return NULL;
    AXUIElementRef current = hit;
    for (int i = 0; current && i < 12; i++) {
        if ([attributeString(current, kAXRoleAttribute) isEqualToString:role]) {
            if (current != hit) CFRelease(hit);
            return current;
        }
        CFTypeRef parent = NULL;
        if (AXUIElementCopyAttributeValue(current, kAXParentAttribute, &parent) != kAXErrorSuccess || !parent) break;
        if (current != hit) CFRelease(current);
        current = (AXUIElementRef)parent;
    }
    if (current && current != hit) CFRelease(current);
    return hit; // No ancestor with that role: act on what is under the point.
}

static bool focusedElementContains(int pid, double x, double y) {
    AXUIElementRef app = AXUIElementCreateApplication(pid);
    CFTypeRef focused = NULL;
    AXError error = AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute, &focused);
    CFRelease(app);
    if (error != kAXErrorSuccess || !focused) return false;
    bool inside = CGRectContainsPoint(elementFrame((AXUIElementRef)focused), CGPointMake(x, y));
    CFRelease(focused);
    return inside;
}

bool hands_layout_key(unsigned int character, int *code, int *shift, bool *available) {
    *available = false;
    TISInputSourceRef source = TISCopyCurrentKeyboardLayoutInputSource();
    if (!source) return false;
    CFDataRef data = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData);
    bool found = false;
    if (data) {
        *available = true;
        const UCKeyboardLayout *layout = (const UCKeyboardLayout *)CFDataGetBytePtr(data);
        for (int level = 0; level < 2 && !found; level++) {
            for (int key = 0; key < 128 && !found; key++) {
                UInt32 dead = 0;
                UniChar text[4];
                UniCharCount length = 0;
                // A dead key produces no text here, so it is never chosen.
                OSStatus status = UCKeyTranslate(layout, key, kUCKeyActionDown, level ? shiftKey >> 8 : 0, LMGetKbdType(), 0, &dead, 4, &length, text);
                if (status == noErr && length == 1 && text[0] == character) {
                    *code = key;
                    *shift = level;
                    found = true;
                }
            }
        }
    }
    CFRelease(source);
    return found;
}

char *hands_act(int pid, double x, double y, const char *role, const char *title, const char *desc, const char *action, const char *value) {
    @autoreleasepool {
        if (!AXIsProcessTrusted()) return failure(@"Accessibility access is not granted. Run `hands permissions --ask`.");
        NSString *wantedRole = [NSString stringWithUTF8String:role];
        NSString *what = [NSString stringWithUTF8String:action];
        AXUIElementRef element = elementAt(pid, x, y, wantedRole);
        if (!element) return failure(@"Nothing is at that position any more. Run `hands see` again.");
        NSString *foundRole = attributeString(element, kAXRoleAttribute);
        // Never act on something other than the element the listing showed.
        NSString *wantedTitle = [NSString stringWithUTF8String:title];
        NSString *wantedDesc = [NSString stringWithUTF8String:desc];
        if (![foundRole isEqualToString:wantedRole] ||
            (wantedTitle.length && ![attributeString(element, kAXTitleAttribute) isEqualToString:wantedTitle]) ||
            (wantedDesc.length && ![attributeString(element, kAXDescriptionAttribute) isEqualToString:wantedDesc])) {
            CFRelease(element);
            return failure(@"The element at that position has changed since the listing, so nothing was done. Run `hands see` again.");
        }
        AXError error = kAXErrorFailure;
        if ([what isEqualToString:@"focus"]) {
            error = AXUIElementSetAttributeValue(element, kAXFocusedAttribute, kCFBooleanTrue);
        } else if ([what isEqualToString:@"set"]) {
            Boolean settable = false;
            AXUIElementIsAttributeSettable(element, kAXValueAttribute, &settable);
            if (settable) {
                NSString *text = [NSString stringWithUTF8String:value];
                error = AXUIElementSetAttributeValue(element, kAXValueAttribute, (__bridge CFTypeRef)text);
            }
        } else {
            error = AXUIElementPerformAction(element, kAXPressAction);
            // Rows and tabs have no press action; selecting them is the click.
            // Outlines act on their selected-rows list, so set that on the parent too.
            if (error != kAXErrorSuccess) {
                Boolean settable = false;
                AXUIElementIsAttributeSettable(element, kAXSelectedAttribute, &settable);
                if (settable) error = AXUIElementSetAttributeValue(element, kAXSelectedAttribute, kCFBooleanTrue);
                CFTypeRef parent = NULL;
                if (AXUIElementCopyAttributeValue(element, kAXParentAttribute, &parent) == kAXErrorSuccess && parent) {
                    NSArray *rows = @[(__bridge id)element];
                    if (AXUIElementSetAttributeValue((AXUIElementRef)parent, kAXSelectedRowsAttribute, (__bridge CFTypeRef)rows) == kAXErrorSuccess) error = kAXErrorSuccess;
                    CFRelease(parent);
                }
            }
        }
        CFRelease(element);
        if (error == kAXErrorSuccess) return dupJSON(@{@"ok": @YES, @"via": @"ax", @"role": foundRole});
        // Focusing must not turn into a click, which could activate the element.
        if ([what isEqualToString:@"focus"]) return failure(@"This element does not accept focus, so nothing was done. Try `hands click N` if clicking it is safe.");
        // The app may have acted without answering in time; a click could do it twice.
        if (error == kAXErrorCannotComplete) return failure(@"The app did not answer. Run `hands see` to check whether it acted.");
        // Fallback: synthetic input, which also works for elements without AX actions.
        if ([what isEqualToString:@"set"]) {
            char *clicked = hands_click(pid, x, y, 0, 1);
            free(clicked);
            usleep(60000);
            // Select-all and type only land safely if the click focused this field.
            if (!focusedElementContains(pid, x, y)) return failure(@"The field refused the value and did not take focus, so nothing was typed. Try `hands click N`, then `hands type`.");
            // The layout's own key for "a": a fixed keycode is Cmd-Q on AZERTY.
            int selectAll = 0, shifted = 0;
            bool available = false;
            if (!hands_layout_key('a', &selectAll, &shifted, &available)) return failure(@"The field refused the value and this keyboard layout has no key for select-all, so nothing was typed.");
            free(hands_key(pid, selectAll, kCGEventFlagMaskCommand));
            usleep(30000);
            sendUnicode(pid, [NSString stringWithUTF8String:value]);
            return dupJSON(@{@"ok": @YES, @"via": @"keyboard", @"role": foundRole});
        }
        return hands_click(pid, x, y, 0, 1);
    }
}

// ── Screenshots and window recording ──────────────────────────────────────

// The app's largest on-screen window, or the one whose title contains `wanted`.
static SCWindow *findWindow(int pid, NSString *wanted, NSString **problem) {
    __block SCShareableContent *content = nil;
    __block NSError *failed = nil;
    dispatch_semaphore_t gate = dispatch_semaphore_create(0);
    [SCShareableContent getShareableContentExcludingDesktopWindows:YES onScreenWindowsOnly:YES completionHandler:^(SCShareableContent *result, NSError *error) {
        content = result;
        failed = error;
        dispatch_semaphore_signal(gate);
    }];
    dispatch_semaphore_wait(gate, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
    if (failed || !content) {
        *problem = [NSString stringWithFormat:@"Could not list windows: %@", failed.localizedDescription ?: @"timed out"];
        return nil;
    }
    SCWindow *target = nil;
    for (SCWindow *window in content.windows) {
        if (window.owningApplication.processID != pid || window.windowLayer != 0) continue;
        if (wanted && ![[window.title lowercaseString] containsString:wanted]) continue;
        if (!target || window.frame.size.width * window.frame.size.height > target.frame.size.width * target.frame.size.height) target = window;
    }
    if (!target) *problem = [NSString stringWithFormat:@"No on-screen window found for pid %d%@.", pid, wanted ? [NSString stringWithFormat:@" with a title containing %@", wanted] : @""];
    return target;
}

static volatile int recordStopRequested = 0;
void hands_record_stop(void) { recordStopRequested = 1; }

// Receives stream frames and appends them to the movie with their own timestamps.
@interface HandsRecorder : NSObject <SCStreamOutput, SCStreamDelegate>
@property (nonatomic) AVAssetWriter *writer;
@property (nonatomic) AVAssetWriterInput *input;
@property (nonatomic) AVAssetWriterInputPixelBufferAdaptor *adaptor;
@property (nonatomic) BOOL started;
@property (nonatomic) long frames;
@property (nonatomic) NSError *streamError;
@end

@implementation HandsRecorder
- (void)stream:(SCStream *)stream didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer ofType:(SCStreamOutputType)type {
    if (type != SCStreamOutputTypeScreen || recordStopRequested) return;
    CFArrayRef attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, false);
    if (attachments && CFArrayGetCount(attachments) > 0) {
        NSDictionary *info = (__bridge NSDictionary *)CFArrayGetValueAtIndex(attachments, 0);
        if ([info[SCStreamFrameInfoStatus] integerValue] != SCFrameStatusComplete) return;
    }
    CVPixelBufferRef pixels = CMSampleBufferGetImageBuffer(sampleBuffer);
    if (!pixels) return;
    CMTime time = CMSampleBufferGetPresentationTimeStamp(sampleBuffer);
    if (!self.started) {
        if (![self.writer startWriting]) return;
        [self.writer startSessionAtSourceTime:time];
        self.started = YES;
    }
    if (self.input.readyForMoreMediaData && [self.adaptor appendPixelBuffer:pixels withPresentationTime:time]) self.frames++;
}
- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error { self.streamError = error; recordStopRequested = 1; }
@end

char *hands_record_window(int pid, const char *window_title, const char *path, int seconds, int fps) {
    @autoreleasepool {
        if (!CGPreflightScreenCaptureAccess()) return failure(@"Screen Recording access is not granted. Run `hands permissions --ask`.");
        NSString *wanted = window_title && *window_title ? [[NSString stringWithUTF8String:window_title] lowercaseString] : nil;
        NSString *problem = nil;
        SCWindow *target = findWindow(pid, wanted, &problem);
        if (!target) return failure(problem);
        CGFloat scale = NSScreen.mainScreen.backingScaleFactor ?: 2;
        // Even dimensions keep H.264 encoders happy.
        size_t width = ((size_t)(target.frame.size.width * scale)) & ~1;
        size_t height = ((size_t)(target.frame.size.height * scale)) & ~1;
        NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path]];
        NSError *error = nil;
        AVAssetWriter *writer = [AVAssetWriter assetWriterWithURL:url fileType:AVFileTypeQuickTimeMovie error:&error];
        if (!writer) return failure([NSString stringWithFormat:@"Could not create %@: %@", url.path, error.localizedDescription]);
        AVAssetWriterInput *input = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeVideo outputSettings:@{AVVideoCodecKey: AVVideoCodecTypeH264, AVVideoWidthKey: @(width), AVVideoHeightKey: @(height)}];
        input.expectsMediaDataInRealTime = YES;
        AVAssetWriterInputPixelBufferAdaptor *adaptor = [AVAssetWriterInputPixelBufferAdaptor assetWriterInputPixelBufferAdaptorWithAssetWriterInput:input sourcePixelBufferAttributes:@{(id)kCVPixelBufferPixelFormatTypeKey: @(kCVPixelFormatType_32BGRA)}];
        [writer addInput:input];
        HandsRecorder *recorder = [HandsRecorder new];
        recorder.writer = writer;
        recorder.input = input;
        recorder.adaptor = adaptor;
        SCContentFilter *filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:target];
        SCStreamConfiguration *config = [SCStreamConfiguration new];
        config.width = width;
        config.height = height;
        config.pixelFormat = kCVPixelFormatType_32BGRA;
        config.minimumFrameInterval = CMTimeMake(1, fps > 0 ? fps : 30);
        config.queueDepth = 5;
        config.showsCursor = YES;
        SCStream *stream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:recorder];
        if (![stream addStreamOutput:recorder type:SCStreamOutputTypeScreen sampleHandlerQueue:dispatch_queue_create("hands.record", DISPATCH_QUEUE_SERIAL) error:&error]) return failure([NSString stringWithFormat:@"Could not attach to the window: %@", error.localizedDescription]);
        dispatch_semaphore_t gate = dispatch_semaphore_create(0);
        __block NSError *failed = nil;
        [stream startCaptureWithCompletionHandler:^(NSError *startError) { failed = startError; dispatch_semaphore_signal(gate); }];
        dispatch_semaphore_wait(gate, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
        if (failed) return failure([NSString stringWithFormat:@"Could not start recording: %@", failed.localizedDescription]);
        NSDate *deadline = seconds > 0 ? [NSDate dateWithTimeIntervalSinceNow:seconds] : nil;
        while (!recordStopRequested && (!deadline || [deadline timeIntervalSinceNow] > 0)) usleep(50000);
        recordStopRequested = 1;
        [stream stopCaptureWithCompletionHandler:^(NSError *stopError) { dispatch_semaphore_signal(gate); }];
        dispatch_semaphore_wait(gate, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
        if (!recorder.started) return failure(@"No frames arrived from the window; is it on screen?");
        [input markAsFinished];
        [writer finishWritingWithCompletionHandler:^{ dispatch_semaphore_signal(gate); }];
        dispatch_semaphore_wait(gate, dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC));
        if (writer.status != AVAssetWriterStatusCompleted) return failure([NSString stringWithFormat:@"Could not finish the movie: %@", writer.error.localizedDescription ?: @"unknown error"]);
        return dupJSON(@{@"ok": @YES, @"path": url.path, @"frames": @(recorder.frames), @"width": @(width), @"height": @(height), @"title": target.title ?: @"", @"error": recorder.streamError.localizedDescription ?: @""});
    }
}

char *hands_shot(int pid, const char *window_title, const char *path) {
    @autoreleasepool {
        if (!CGPreflightScreenCaptureAccess()) return failure(@"Screen Recording access is not granted. Run `hands permissions --ask` and allow Herdr in System Settings › Privacy & Security › Screen Recording.");
        NSString *wanted = window_title && *window_title ? [[NSString stringWithUTF8String:window_title] lowercaseString] : nil;
        NSString *problem = nil;
        SCWindow *target = findWindow(pid, wanted, &problem);
        if (!target) return failure(problem);
        dispatch_semaphore_t gate = dispatch_semaphore_create(0);
        __block NSError *failed = nil;
        CGFloat scale = NSScreen.mainScreen.backingScaleFactor ?: 2;
        SCContentFilter *filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:target];
        SCStreamConfiguration *config = [SCStreamConfiguration new];
        config.width = (size_t)(target.frame.size.width * scale);
        config.height = (size_t)(target.frame.size.height * scale);
        config.showsCursor = NO;
        config.captureResolution = SCCaptureResolutionBest;
        __block CGImageRef image = NULL;
        failed = nil;
        [SCScreenshotManager captureImageWithFilter:filter configuration:config completionHandler:^(CGImageRef result, NSError *error) {
            if (result) image = CGImageRetain(result);
            failed = error;
            dispatch_semaphore_signal(gate);
        }];
        dispatch_semaphore_wait(gate, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
        if (!image) return failure([NSString stringWithFormat:@"Screenshot failed: %@", failed.localizedDescription ?: @"timed out"]);
        NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path]];
        CGImageDestinationRef destination = CGImageDestinationCreateWithURL((__bridge CFURLRef)url, (__bridge CFStringRef)UTTypePNG.identifier, 1, NULL);
        bool written = false;
        if (destination) {
            CGImageDestinationAddImage(destination, image, NULL);
            written = CGImageDestinationFinalize(destination);
            CFRelease(destination);
        }
        NSDictionary *result = @{@"ok": @(written), @"width": @(CGImageGetWidth(image)), @"height": @(CGImageGetHeight(image)), @"title": target.title ?: @"", @"path": url.path};
        CGImageRelease(image);
        return written ? dupJSON(result) : failure([NSString stringWithFormat:@"Could not write %@.", url.path]);
    }
}
