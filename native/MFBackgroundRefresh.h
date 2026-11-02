#import <Foundation/Foundation.h>

/// iOS background app refresh (BGTaskScheduler). Call `+registerTask` from the app delegate
/// before launch finishes; each run is handed to JS as MFNative's `backgroundRefresh` event.
@interface MFBackgroundRefresh : NSObject
+ (void)registerTask;
@end
