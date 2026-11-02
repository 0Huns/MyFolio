#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#if TARGET_OS_OSX
#import <AppKit/AppKit.h>
#else
#import <UIKit/UIKit.h>
#import <React/RCTUtils.h>
#import <BackgroundTasks/BackgroundTasks.h>
#import "MFBackgroundRefresh.h"
#endif
#import <Security/Security.h>
#import <CommonCrypto/CommonCrypto.h>
#import <CommonCrypto/CommonHMAC.h>

/// Small native bridge for things JS can't do on its own (shared by the macOS and iOS apps):
/// Keychain, app data file, HMAC/SHA hashing, base64, save panel / share sheet
/// and (iOS) background refresh.
@interface MFNative : RCTEventEmitter <RCTBridgeModule>
- (void)deliverBackgroundRefresh;
@end

static NSString *const kService = @"local.myfolio.rn.credentials";

static NSString *Hex(const unsigned char *bytes, size_t len) {
  NSMutableString *s = [NSMutableString stringWithCapacity:len * 2];
  for (size_t i = 0; i < len; i++) [s appendFormat:@"%02x", bytes[i]];
  return s;
}

#import <React/RCTView.h>
#import <React/RCTViewManager.h>

#pragma mark Chart pointer tracking (macOS)

#if TARGET_OS_OSX
#import <React/RCTView.h>
#import <React/RCTViewManager.h>

/// Transparent overlay for the price chart. RN-macOS views only report mouse enter/leave, so this reports the pointer
/// position (onChartPointer {x, y}, view coordinates), leaving (onChartLeave), scroll wheel / trackpad
/// (onChartWheel {dx, dy, precise}) and mouse drags (onChartDrag {dx}).
/// Don't rename these to onPointerMove/onPointerLeave: RCTViewManager already exports those for RN pointer events,
/// and RN then fills the block with its own value — calling it crashed the app on mouse enter.
@interface MFChartTrackerView : RCTView
@property (nonatomic, copy) RCTDirectEventBlock onChartPointer;
@property (nonatomic, copy) RCTDirectEventBlock onChartLeave;
@property (nonatomic, copy) RCTDirectEventBlock onChartWheel;
@property (nonatomic, copy) RCTDirectEventBlock onChartDrag;
@end

@implementation MFChartTrackerView {
  NSTrackingArea *_area;
}

- (void)updateTrackingAreas
{
  [super updateTrackingAreas];
  if (_area) [self removeTrackingArea:_area];
  _area = [[NSTrackingArea alloc] initWithRect:NSZeroRect
                                       options:NSTrackingMouseMoved | NSTrackingMouseEnteredAndExited | NSTrackingActiveInKeyWindow | NSTrackingInVisibleRect
                                         owner:self userInfo:nil];
  [self addTrackingArea:_area];
}

- (void)sendPointer:(NSEvent *)event
{
  if (!self.onChartPointer) return;
  NSPoint p = [self convertPoint:event.locationInWindow fromView:nil]; // flipped: y grows downward like RN
  self.onChartPointer(@{@"x": @(p.x), @"y": @(p.y)});
}

- (void)mouseMoved:(NSEvent *)event { [self sendPointer:event]; }
- (void)mouseEntered:(NSEvent *)event { [self sendPointer:event]; }
- (void)mouseExited:(NSEvent *)event { if (self.onChartLeave) self.onChartLeave(@{}); }
- (void)mouseDown:(NSEvent *)event { [self sendPointer:event]; }
- (void)mouseDragged:(NSEvent *)event
{
  if (self.onChartDrag) self.onChartDrag(@{@"dx": @(event.deltaX)});
  [self sendPointer:event];
}

- (void)scrollWheel:(NSEvent *)event
{
  if (!self.onChartWheel) { [super scrollWheel:event]; return; }
  self.onChartWheel(@{@"dx": @(event.scrollingDeltaX), @"dy": @(event.scrollingDeltaY), @"precise": @(event.hasPreciseScrollingDeltas)});
  [self sendPointer:event];
}

@end

@interface MFChartTrackerManager : RCTViewManager
@end

@implementation MFChartTrackerManager
RCT_EXPORT_MODULE(MFChartTracker)
- (RCTPlatformView *)view { return [MFChartTrackerView new]; }
RCT_EXPORT_VIEW_PROPERTY(onChartPointer, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onChartLeave, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onChartWheel, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onChartDrag, RCTDirectEventBlock)
@end
#endif

#pragma mark Background refresh (iOS)

#if !TARGET_OS_OSX
static NSString *const kRefreshTask = @"local.myfolio.rn.refresh";
// Main-queue state: the task iOS handed us, and the JS side that should run it (once it has loaded).
static BGTask *gPendingTask;
static __weak MFNative *gReadyModule;

@implementation MFBackgroundRefresh

+ (void)registerTask
{
  [BGTaskScheduler.sharedScheduler registerForTaskWithIdentifier:kRefreshTask usingQueue:dispatch_get_main_queue()
                                                   launchHandler:^(BGTask *task) {
    [self schedule]; // queue the next run first
    if (gPendingTask) [gPendingTask setTaskCompletedWithSuccess:NO];
    gPendingTask = task;
    task.expirationHandler = ^{ [MFBackgroundRefresh finish:NO]; };
    [gReadyModule deliverBackgroundRefresh]; // nil until JS is ready → delivered by backgroundReady instead
  }];
  [NSNotificationCenter.defaultCenter addObserverForName:UIApplicationDidEnterBackgroundNotification object:nil
                                                   queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *n) { [self schedule]; }];
}

/// iOS decides when it actually runs (usage, battery, network); 15 minutes is only the earliest.
+ (void)schedule
{
  BGAppRefreshTaskRequest *r = [[BGAppRefreshTaskRequest alloc] initWithIdentifier:kRefreshTask];
  r.earliestBeginDate = [NSDate dateWithTimeIntervalSinceNow:15 * 60];
  [BGTaskScheduler.sharedScheduler submitTaskRequest:r error:nil];
}

+ (void)finish:(BOOL)success
{
  [gPendingTask setTaskCompletedWithSuccess:success];
  gPendingTask = nil;
}

@end
#endif

@implementation MFNative
{
  BOOL _hasListeners;
}

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup { return NO; }

- (NSArray<NSString *> *)supportedEvents { return @[@"backgroundRefresh"]; }
- (void)startObserving { _hasListeners = YES; }
- (void)stopObserving { _hasListeners = NO; }

- (void)deliverBackgroundRefresh
{
#if !TARGET_OS_OSX
  if (gPendingTask && _hasListeners) [self sendEventWithName:@"backgroundRefresh" body:nil];
#endif
}

/// JS has loaded its data and subscribed: run a refresh that arrived while it was starting up.
RCT_EXPORT_METHOD(backgroundReady:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
{
#if !TARGET_OS_OSX
  dispatch_async(dispatch_get_main_queue(), ^{
    gReadyModule = self;
    [self deliverBackgroundRefresh];
  });
#endif
  resolve(@YES);
}

RCT_EXPORT_METHOD(backgroundDone:(BOOL)success
                  resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
{
#if !TARGET_OS_OSX
  dispatch_async(dispatch_get_main_queue(), ^{ [MFBackgroundRefresh finish:success]; });
#endif
  resolve(@YES);
}

#pragma mark Keychain

static NSDictionary *KeyQuery(NSString *key) {
  return @{(__bridge id)kSecClass : (__bridge id)kSecClassGenericPassword,
           (__bridge id)kSecAttrService : kService,
           (__bridge id)kSecAttrAccount : key};
}

RCT_EXPORT_METHOD(keychainSet:(NSString *)key value:(NSString *)value
                  resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
{
  SecItemDelete((__bridge CFDictionaryRef)KeyQuery(key));
  NSMutableDictionary *q = [KeyQuery(key) mutableCopy];
  q[(__bridge id)kSecValueData] = [value dataUsingEncoding:NSUTF8StringEncoding];
  q[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleAfterFirstUnlock;
  OSStatus st = SecItemAdd((__bridge CFDictionaryRef)q, NULL);
  if (st == errSecSuccess) resolve(@YES);
  else reject(@"keychain", [NSString stringWithFormat:@"Keychain error %d", (int)st], nil);
}

RCT_EXPORT_METHOD(keychainGet:(NSString *)key
                  resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
{
  NSMutableDictionary *q = [KeyQuery(key) mutableCopy];
  q[(__bridge id)kSecReturnData] = @YES;
  q[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
  CFTypeRef out = NULL;
  if (SecItemCopyMatching((__bridge CFDictionaryRef)q, &out) == errSecSuccess && out) {
    NSData *d = (__bridge_transfer NSData *)out;
    resolve([[NSString alloc] initWithData:d encoding:NSUTF8StringEncoding]);
  } else {
    resolve([NSNull null]);
  }
}

RCT_EXPORT_METHOD(keychainDelete:(NSString *)key
                  resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
{
  SecItemDelete((__bridge CFDictionaryRef)KeyQuery(key));
  resolve(@YES);
}

#pragma mark Data file

static NSURL *DataURL(void) {
  NSURL *dir = [[[NSFileManager defaultManager] URLsForDirectory:NSApplicationSupportDirectory
                                                        inDomains:NSUserDomainMask].firstObject
                URLByAppendingPathComponent:@"MyFolio" isDirectory:YES];
  [[NSFileManager defaultManager] createDirectoryAtURL:dir withIntermediateDirectories:YES attributes:nil error:nil];
  return [dir URLByAppendingPathComponent:@"data.json"];
}

RCT_EXPORT_METHOD(readData:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
{
  NSString *s = [NSString stringWithContentsOfURL:DataURL() encoding:NSUTF8StringEncoding error:nil];
  resolve(s ?: [NSNull null]);
}

RCT_EXPORT_METHOD(writeData:(NSString *)text
                  resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
{
  NSError *err = nil;
  [text writeToURL:DataURL() atomically:YES encoding:NSUTF8StringEncoding error:&err];
  if (err) reject(@"write", err.localizedDescription, err); else resolve(@YES);
}

#pragma mark Crypto

RCT_EXPORT_METHOD(hmacHex:(NSString *)alg key:(NSString *)key message:(NSString *)message
                  resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
{
  NSData *k = [key dataUsingEncoding:NSUTF8StringEncoding];
  NSData *m = [message dataUsingEncoding:NSUTF8StringEncoding];
  BOOL sha512 = [alg isEqualToString:@"sha512"];
  size_t len = sha512 ? CC_SHA512_DIGEST_LENGTH : CC_SHA256_DIGEST_LENGTH;
  unsigned char out[CC_SHA512_DIGEST_LENGTH];
  CCHmac(sha512 ? kCCHmacAlgSHA512 : kCCHmacAlgSHA256, k.bytes, k.length, m.bytes, m.length, out);
  resolve(Hex(out, len));
}

RCT_EXPORT_METHOD(sha512Hex:(NSString *)message
                  resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
{
  NSData *m = [message dataUsingEncoding:NSUTF8StringEncoding];
  unsigned char out[CC_SHA512_DIGEST_LENGTH];
  CC_SHA512(m.bytes, (CC_LONG)m.length, out);
  resolve(Hex(out, CC_SHA512_DIGEST_LENGTH));
}

RCT_EXPORT_METHOD(base64:(NSString *)text
                  resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
{
  resolve([[text dataUsingEncoding:NSUTF8StringEncoding] base64EncodedStringWithOptions:0]);
}

/// hex bytes → standard base64 (used for JWT signatures)
RCT_EXPORT_METHOD(hexToBase64:(NSString *)hex
                  resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
{
  NSMutableData *d = [NSMutableData dataWithCapacity:hex.length / 2];
  for (NSUInteger i = 0; i + 1 < hex.length; i += 2) {
    unsigned int b = 0;
    [[NSScanner scannerWithString:[hex substringWithRange:NSMakeRange(i, 2)]] scanHexInt:&b];
    unsigned char c = (unsigned char)b;
    [d appendBytes:&c length:1];
  }
  resolve([d base64EncodedStringWithOptions:0]);
}

#pragma mark Appearance

RCT_EXPORT_METHOD(setAppearance:(NSString *)mode
                  resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
#if TARGET_OS_OSX
    NSApp.appearance = [mode isEqualToString:@"light"] ? [NSAppearance appearanceNamed:NSAppearanceNameAqua]
                     : [mode isEqualToString:@"dark"] ? [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua] : nil;
#else
    UIUserInterfaceStyle style = [mode isEqualToString:@"light"] ? UIUserInterfaceStyleLight
                               : [mode isEqualToString:@"dark"] ? UIUserInterfaceStyleDark : UIUserInterfaceStyleUnspecified;
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
      if (![scene isKindOfClass:UIWindowScene.class]) continue;
      for (UIWindow *w in ((UIWindowScene *)scene).windows) w.overrideUserInterfaceStyle = style;
    }
#endif
    resolve(@YES);
  });
}

#pragma mark Save panel

RCT_EXPORT_METHOD(saveFile:(NSString *)name content:(NSString *)content
                  resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
{
  // UTF-8 BOM so Excel opens Korean text correctly
  NSMutableData *d = [NSMutableData dataWithBytes:"\xEF\xBB\xBF" length:3];
  [d appendData:[content dataUsingEncoding:NSUTF8StringEncoding]];
  dispatch_async(dispatch_get_main_queue(), ^{
#if TARGET_OS_OSX
    NSSavePanel *panel = [NSSavePanel savePanel];
    panel.nameFieldStringValue = name;
    if ([panel runModal] == NSModalResponseOK && panel.URL) {
      [d writeToURL:panel.URL atomically:YES];
      resolve(@YES);
    } else {
      resolve(@NO);
    }
#else
    // iOS has no save panel: write a temp file and hand it to the share sheet (Files, AirDrop, Mail…).
    NSURL *url = [NSURL fileURLWithPath:[NSTemporaryDirectory() stringByAppendingPathComponent:name]];
    [d writeToURL:url atomically:YES];
    UIViewController *top = RCTPresentedViewController();
    if (!top) { resolve(@NO); return; }
    UIActivityViewController *share = [[UIActivityViewController alloc] initWithActivityItems:@[url] applicationActivities:nil];
    share.popoverPresentationController.sourceView = top.view; // iPad presents it as a popover
    share.popoverPresentationController.sourceRect = CGRectMake(CGRectGetMidX(top.view.bounds), CGRectGetMidY(top.view.bounds), 0, 0);
    share.popoverPresentationController.permittedArrowDirections = 0;
    share.completionWithItemsHandler = ^(UIActivityType type, BOOL completed, NSArray *items, NSError *error) {
      resolve(@(completed));
    };
    [top presentViewController:share animated:YES completion:nil];
#endif
  });
}

#pragma mark Clipboard

RCT_EXPORT_METHOD(copyText:(NSString *)text
                  resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
#if TARGET_OS_OSX
    [NSPasteboard.generalPasteboard clearContents];
    resolve(@([NSPasteboard.generalPasteboard setString:text forType:NSPasteboardTypeString]));
#else
    UIPasteboard.generalPasteboard.string = text;
    resolve(@YES);
#endif
  });
}

#pragma mark Widget (macOS)

#if TARGET_OS_OSX
/// Team-prefixed App Group, set in Info.plist from DEVELOPMENT_TEAM at build time.
#define kAppGroup ((NSString *)(NSBundle.mainBundle.infoDictionary[@"MFAppGroup"] ?: @""))

/// Only builds signed with the App Group entitlement (scripts/build-macos.sh) write — an unentitled Debug build
/// touching the group container would make macOS prompt about accessing another app's data.
static BOOL HasAppGroup(void)
{
  static BOOL has;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    SecTaskRef task = SecTaskCreateFromSelf(NULL);
    if (!task) return;
    CFTypeRef v = SecTaskCopyValueForEntitlement(task, CFSTR("com.apple.security.application-groups"), NULL);
    has = v && CFGetTypeID(v) == CFArrayGetTypeID() && [(__bridge NSArray *)v containsObject:kAppGroup];
    if (v) CFRelease(v);
    CFRelease(task);
  });
  return has;
}
#endif

/// Summary JSON for the desktop widget, then ask WidgetKit to re-read it.
RCT_EXPORT_METHOD(writeWidget:(NSString *)json
                  resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
{
#if TARGET_OS_OSX
  NSURL *dir = HasAppGroup() ? [NSFileManager.defaultManager containerURLForSecurityApplicationGroupIdentifier:kAppGroup] : nil;
  if (!dir) { resolve(@NO); return; }
  [NSFileManager.defaultManager createDirectoryAtURL:dir withIntermediateDirectories:YES attributes:nil error:nil];
  BOOL ok = [json writeToURL:[dir URLByAppendingPathComponent:@"widget.json"] atomically:YES encoding:NSUTF8StringEncoding error:nil];
  if (ok) {
    dispatch_async(dispatch_get_main_queue(), ^{
      Class reloader = NSClassFromString(@"MFWidgetReloader"); // Swift, in the app target
      if ([reloader respondsToSelector:@selector(reload)]) [reloader performSelector:@selector(reload)];
    });
  }
  resolve(@(ok));
#else
  resolve(@NO);
#endif
}

@end
