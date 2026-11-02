import AppIntents
import CoreText
import SwiftUI
import WidgetKit

/// Shared with the app (team-prefixed App Group, so no provisioning profile is needed on macOS).
private let appGroup = Bundle.main.object(forInfoDictionaryKey: "MFAppGroup") as? String ?? ""

/// Written by the app (`store.writeWidget`) to `<group container>/widget.json`.
/// Fields added later are optional so a file from an older app build still decodes.
struct Snapshot: Decodable {
  /// Laid out by the app for a 328 × 190 box; `rate` is nil for cash.
  struct Bubble: Decodable {
    let label: String
    let rate: Double?
    let x: Double
    let y: Double
    let r: Double
  }

  struct Holding: Decodable {
    let name: String
    let ticker: String
    let value: Double // KRW
    let price: Double?
    let currency: String?
    let dayRate: Double?
    let ret: Double
    let quantity: Double?
    let crypto: Bool?
    let pnl: Double? // KRW
  }

  let updatedAt: Double // ms since 1970
  let hidden: Bool
  let usdKrw: Double? // set when the app shows amounts in dollars
  let total: Double // holdings + cash
  let invested: Double? // holdings only ("내 투자")
  let pnl: Double
  let pnlRate: Double
  let day: Double?
  let dayRate: Double?
  let cash: Double?
  let holdings: [Holding]
  let bubbles: [Bubble]?
  let history: [Double]

  static func load() -> Snapshot? {
    guard let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
      .appendingPathComponent("widget.json"),
      let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(Snapshot.self, from: data)
  }

  /// Widget gallery preview: made-up numbers, nothing from a real account.
  static let sample = Snapshot(
    updatedAt: Date().timeIntervalSince1970 * 1000, hidden: false, usdKrw: nil, total: 2_400_000, invested: 2_100_000,
    pnl: 150_000, pnlRate: 6.6, day: 12_300, dayRate: 0.5, cash: 300_000,
    holdings: [
      Holding(name: "샘플전자", ticker: "000000", value: 1_080_000, price: 90_000, currency: "krw", dayRate: 3.2, ret: 9.7,
              quantity: 12, crypto: false, pnl: 96_000),
      Holding(name: "예시테크", ticker: "SMPL", value: 620_000, price: 100, currency: "usd", dayRate: -1.4, ret: 5.0,
              quantity: 5, crypto: false, pnl: 30_000),
      Holding(name: "모의은행", ticker: "000001", value: 400_000, price: 50_000, currency: "krw", dayRate: 0.8, ret: 6.0,
              quantity: 8, crypto: false, pnl: 24_000),
    ],
    bubbles: [
      Bubble(label: "샘플전자", rate: 3.2, x: 95, y: 95, r: 88),
      Bubble(label: "예시테크", rate: -1.4, x: 232, y: 60, r: 58),
      Bubble(label: "모의은행", rate: 0.8, x: 235, y: 150, r: 38),
      Bubble(label: "현금", rate: nil, x: 298, y: 118, r: 28),
    ],
    history: [])
}

// MARK: - Formatting (Korean market convention: gains red, losses blue)

private let up = Color(red: 0.94, green: 0.27, blue: 0.32)
private let down = Color(red: 0.19, green: 0.51, blue: 0.96)
private func tone(_ v: Double) -> Color { v > 0 ? up : v < 0 ? down : .secondary }

private func grouped(_ v: Double, digits: Int = 0) -> String {
  let f = NumberFormatter()
  f.numberStyle = .decimal
  f.maximumFractionDigits = digits
  return f.string(from: NSNumber(value: digits == 0 ? v.rounded() : v)) ?? "0"
}

private let hhmm: DateFormatter = {
  let f = DateFormatter()
  f.dateFormat = "HH:mm"
  return f
}()

private let mask = "••••••"
/// A KRW amount in the app's display currency: "1,234,567원", or "$912" / "$12.34" converted at `usd`.
private func won(_ v: Double, _ hidden: Bool, _ usd: Double? = nil) -> String {
  if let usd, usd > 0 {
    let d = v / usd
    return hidden ? "$" + mask : (d < 0 ? "-$" : "$") + grouped(abs(d), digits: abs(d) < 100 ? 2 : 0)
  }
  return hidden ? mask + "원" : grouped(v.rounded(.towardZero)) + "원"
}
private func signed(_ v: Double, _ hidden: Bool, unit: String = "", _ usd: Double? = nil) -> String {
  if usd != nil { return (v > 0 && !hidden ? "+" : "") + won(v, hidden, usd) }
  return hidden ? mask + unit : (v > 0 ? "+" : "") + grouped(v.rounded(.towardZero)) + unit
}
/// "(24.2%)" — one decimal, sign carried by the amount in front of it.
private func rate(_ v: Double) -> String { String(format: "(%.1f%%)", v) }

// MARK: - Timeline

struct Entry: TimelineEntry {
  let date: Date
  let snapshot: Snapshot?
}

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> Entry { Entry(date: .now, snapshot: .sample) }

  func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
    completion(Entry(date: .now, snapshot: context.isPreview ? .sample : Snapshot.load() ?? .sample))
  }

  /// The app reloads timelines when it writes new numbers; the 15-minute refresh is only a fallback.
  func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
    completion(Timeline(entries: [Entry(date: .now, snapshot: Snapshot.load())], policy: .after(.now.addingTimeInterval(15 * 60))))
  }
}

/// ↻ button: re-reads the numbers the app last saved (the app itself refreshes them every minute while running).
struct RefreshIntent: AppIntent {
  static var title: LocalizedStringResource = "새로고침"

  func perform() async throws -> some IntentResult {
    WidgetCenter.shared.reloadAllTimelines()
    return .result()
  }
}

// MARK: - Views

private func appFont(_ size: CGFloat, bold: Bool = false) -> Font {
  .custom(bold ? "NanumSquareRoundB" : "NanumSquareRoundR", size: size)
}

private let heroColor = Color(red: 1, green: 0.847, blue: 0.302)
private let ink = Color(red: 0.086, green: 0.125, blue: 0.18)

/// "12,300원 늘었어요"; the total when today's change is unknown. Hidden amounts hide the direction too.
private func headline(_ s: Snapshot) -> String {
  if s.hidden { return "\(mask)원 금액 숨김" }
  guard let day = s.day else { return won(s.total, false, s.usdKrw) }
  if day.rounded(.towardZero) == 0 { return "어제와 같아요" }
  return "\(won(abs(day), false, s.usdKrw)) \(day > 0 ? "늘었어요" : "줄었어요")"
}
private func heroLabel(_ s: Snapshot) -> String { s.day == nil && !s.hidden ? "내 전체 자산" : "오늘의 내 돈" }
private func percent(_ v: Double) -> String { String(format: "%@%.1f%%", v > 0 ? "+" : "", v) }

struct PortfolioView: View {
  @Environment(\.widgetFamily) private var environmentFamily
  let entry: Entry
  /// Lets an offscreen render (outside WidgetKit) pick the size.
  var familyOverride: WidgetFamily?

  var body: some View {
    let family = familyOverride ?? environmentFamily
    Group {
      if let s = entry.snapshot {
        switch family {
        case .systemSmall: SmallView(s: s)
        case .systemMedium: MediumView(s: s)
        default: LargeView(s: s)
        }
      } else {
        VStack(alignment: .leading, spacing: 6) {
          Text("내 투자").font(appFont(14)).foregroundStyle(.secondary)
          Text("앱을 열어 계좌를 연결하면 여기에 표시돼요.").font(appFont(12)).foregroundStyle(.secondary)
          Spacer(minLength: 0)
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .containerBackground(family == .systemSmall && entry.snapshot != nil ? AnyShapeStyle(heroColor) : AnyShapeStyle(.background), for: .widget)
  }
}

/// "오늘의 내 돈 ········ ↻"
private struct HeroHeader: View {
  let s: Snapshot

  var body: some View {
    HStack(spacing: 6) {
      Text(heroLabel(s)).font(appFont(12)).foregroundStyle(ink)
      Spacer(minLength: 4)
      Button(intent: RefreshIntent()) {
        Image(systemName: "arrow.clockwise").font(.system(size: 12, weight: .semibold)).foregroundStyle(ink)
      }
      .buttonStyle(.plain)
    }
  }
}

private struct Updated: View {
  let s: Snapshot

  var body: some View {
    Text("\(hhmm.string(from: Date(timeIntervalSince1970: s.updatedAt / 1000))) 기준").font(appFont(11))
  }
}

private struct SmallView: View {
  let s: Snapshot

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HeroHeader(s: s)
      Spacer(minLength: 2)
      Text(headline(s)).font(appFont(22, bold: true)).lineLimit(2).minimumScaleFactor(0.6)
      Spacer(minLength: 2)
      Text(won(s.total, s.hidden, s.usdKrw)).font(appFont(13, bold: true)).monospacedDigit().lineLimit(1)
      Updated(s: s)
    }
    .foregroundStyle(ink)
  }
}

private struct MediumView: View {
  let s: Snapshot

  var body: some View {
    HStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 0) {
        HeroHeader(s: s)
        Spacer(minLength: 2)
        Text(headline(s)).font(appFont(20, bold: true)).lineLimit(2).minimumScaleFactor(0.6)
        Spacer(minLength: 2)
        Updated(s: s)
      }
      .foregroundStyle(ink)
      .padding(12)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
      .background(heroColor, in: RoundedRectangle(cornerRadius: 16, style: .continuous))

      VStack(alignment: .leading, spacing: 5) {
        Text("내 전체 자산").font(appFont(12)).foregroundStyle(.secondary)
        Text(won(s.total, s.hidden, s.usdKrw)).font(appFont(17, bold: true)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
        Spacer(minLength: 0)
        ForEach(Array(s.holdings.prefix(3).enumerated()), id: \.offset) { _, h in
          HStack {
            Text(h.name).font(appFont(13)).lineLimit(1)
            Spacer(minLength: 4)
            if let d = h.dayRate {
              Text(percent(d)).font(appFont(13, bold: true)).monospacedDigit().foregroundStyle(tone(d))
            }
          }
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
  }
}

private struct LargeView: View {
  let s: Snapshot

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      VStack(alignment: .leading, spacing: 2) {
        HeroHeader(s: s)
        Text(headline(s)).font(appFont(21, bold: true)).lineLimit(1).minimumScaleFactor(0.6)
      }
      .foregroundStyle(ink)
      .padding(.horizontal, 14).padding(.vertical, 10)
      .background(heroColor, in: RoundedRectangle(cornerRadius: 16, style: .continuous))

      HStack(alignment: .firstTextBaseline) {
        Text(won(s.total, s.hidden, s.usdKrw)).font(appFont(18, bold: true)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
        Spacer(minLength: 4)
        Text("\(signed(s.pnl, s.hidden, unit: "원", s.usdKrw)) \(rate(s.pnlRate))")
          .font(appFont(13)).monospacedDigit().foregroundStyle(tone(s.pnl)).lineLimit(1).minimumScaleFactor(0.7)
      }
      GeometryReader { box in
        let scale = min(box.size.width / 328, box.size.height / 190)
        ZStack(alignment: .topLeading) {
          ForEach(Array((s.bubbles ?? []).enumerated()), id: \.offset) { _, b in
            BubbleView(b: b, scale: scale)
              .position(x: b.x * scale, y: b.y * scale)
          }
        }
      }
      HStack {
        Spacer(minLength: 0)
        Updated(s: s).foregroundStyle(.secondary)
      }
    }
  }
}

private struct BubbleView: View {
  let b: Snapshot.Bubble
  let scale: Double

  private var color: Color {
    guard let r = b.rate, r != 0 else { return Color(red: 0.29, green: 0.325, blue: 0.408) }
    return r > 0 ? Color(red: 0.85, green: 0.176, blue: 0.227) : Color(red: 0.145, green: 0.388, blue: 0.922)
  }

  var body: some View {
    let r = b.r * scale
    ZStack {
      Circle().fill(color)
      if r >= 20 {
        VStack(spacing: 0) {
          Text(b.label).font(appFont(max(10, min(16, r / 3.4)), bold: true)).lineLimit(1).minimumScaleFactor(0.7)
          if r >= 30, let v = b.rate {
            Text(percent(v)).font(appFont(max(10, min(14, r / 3.8)))).monospacedDigit()
          }
        }
        .foregroundStyle(.white)
        .padding(4)
      }
    }
    .frame(width: r * 2, height: r * 2)
  }
}

// MARK: - Widget

struct PortfolioWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "PortfolioWidget", provider: Provider()) { entry in
      PortfolioView(entry: entry)
    }
    .configurationDisplayName("오늘의 내 돈")
    .description("오늘 얼마나 변했는지 한 문장으로 보여줘요.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

@main
struct MyFolioWidgetBundle: WidgetBundle {
  /// Extensions don't pick up the app's fonts: register the copy bundled with the widget.
  init() {
    for name in ["NanumSquareRoundR", "NanumSquareRoundB"] {
      if let url = Bundle.main.url(forResource: name, withExtension: "ttf") {
        CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
      }
    }
  }

  var body: some Widget { PortfolioWidget() }
}
