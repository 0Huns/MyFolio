#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification
{
  self.moduleName = @"MyFolioRN";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};
  self.dependencyProvider = [RCTAppDependencyProvider new];
  
  [super applicationDidFinishLaunching:notification];

  // Window title / initial size (RCTAppDelegate names the window after the JS module).
  dispatch_async(dispatch_get_main_queue(), ^{
    NSWindow *w = self.window;
    // Closing only hides the window: it is reopened from the Dock while the app keeps running.
    w.releasedWhenClosed = NO;
    w.title = @"MyFolio";
    w.minSize = NSMakeSize(980, 620);
    [w setContentSize:NSMakeSize(1240, 800)];
    [w center];
  });
}

// Keep running (prices, background sync, filing alerts) after the window is closed.
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender
{
  return NO;
}

// Reopen the main window when the Dock icon is clicked. NSApp.windows may also hold internal windows,
// so show the React Native window itself.
- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)flag
{
  if (!flag) {
    NSWindow *w = self.window;
    if (w.isMiniaturized) [w deminiaturize:self];
    [w makeKeyAndOrderFront:self];
    [NSApp activateIgnoringOtherApps:YES];
  }
  return YES;
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

/// This method controls whether the `concurrentRoot`feature of React18 is turned on or off.
///
/// @see: https://reactjs.org/blog/2022/03/29/react-v18.html
/// @note: This requires to be rendering on Fabric (i.e. on the New Architecture).
/// @return: `true` if the `concurrentRoot` feature is enabled. Otherwise, it returns `false`.
- (BOOL)concurrentRootEnabled
{
#ifdef RN_FABRIC_ENABLED
  return true;
#else
  return false;
#endif
}

@end
