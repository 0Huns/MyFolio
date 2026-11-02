import * as RN from 'react-native';
import { ColorValue, Platform, TextStyle, useWindowDimensions } from 'react-native';

export const isIOS = Platform.OS === 'ios';

/** Light/dark pair resolved natively, so it follows both the system and the in-app appearance override. */
function dyn(light: string, dark: string): ColorValue {
  if (isIOS) return RN.DynamicColorIOS({ light, dark });
  if (Platform.OS === 'macos') return (RN as any).DynamicColorMacOS({ light, dark });
  return light;
}

/** Flat fintech palette: gray canvas, white cards, one blue accent. */
export const C = {
  label: dyn('#191F28', '#F2F5F3'),
  secondary: dyn('#6B7684', '#BFCCC6'),
  tertiary: dyn('#B0B8C1', '#9DB0A7'),
  window: dyn('#E6F6EE', '#0B1411'), // the mint page background, deepened in dark mode so light text stays readable
  control: dyn('#FFFFFF', '#22342D'), // card / sheet surface
  separator: dyn('#E5E8EB', '#3A4E45'),
  accent: dyn('#3182F6', '#8FBCFF'),
  red: dyn('#F04452', '#FF8A91'),
  blue: dyn('#3182F6', '#8FBCFF'),
  orange: dyn('#FE9800', '#FFBE5C'),
  green: dyn('#03B26C', '#5FDDAB'),
  selected: dyn('#E8F3FF', '#1C2D45'),
  fill: dyn('#F2F4F6', '#2E433A'),
  redSoft: dyn('#FFEEEE', '#4A2228'),
  orangeSoft: dyn('#FFF4E0', '#43321A'),
  hero: '#FFD84D', // one-sentence summary cards, same in both appearances
  onHero: '#16202E',
  chip: dyn('#E3E8F2', '#34493F'),
  chipOn: dyn('#16202E', '#F2F5F3'),
  onChipOn: dyn('#FFFFFF', '#16202E'),
  panel: dyn('#10141F', '#22342D'), // dark panel behind the bubble map
  panelBox: dyn('#1C2233', '#2E433A'),
  goalInk: dyn('#0F3D2E', '#F2F5F3'),
  goalMuted: dyn('#2C5E4C', '#BFCCC6'),
  onGoalInk: dyn('#FFFFFF', '#0F3D2E'),
};

/** The app's one typeface, bundled with the app. */
export const FONT = 'NanumSquareRound';

/** Base text size: phones read at arm's length, the Mac UI stays denser. */
export const FS = isIOS ? 15 : 14;

/** Phone-sized window (iPhone, or a narrow iPad split view): single-column layouts. */
export const useCompact = () => useWindowDimensions().width < 700;

/** Korean market convention: gains red, losses blue. */
export const pnlColor = (v: number) => (v > 0 ? C.red : v < 0 ? C.blue : C.secondary);

/** Digits line up in columns. */
export const num: TextStyle = { fontVariant: ['tabular-nums'] };
