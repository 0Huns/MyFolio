import Foundation
import WidgetKit

/// Lets MFNative (Objective-C) ask WidgetKit to re-read widget.json; looked up by name via NSClassFromString.
@objc(MFWidgetReloader)
final class MFWidgetReloader: NSObject {
  @objc static func reload() {
    WidgetCenter.shared.reloadAllTimelines()
  }
}
