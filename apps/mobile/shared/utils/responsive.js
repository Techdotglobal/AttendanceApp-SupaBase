import { Dimensions, Platform, PixelRatio } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Base dimensions (iPhone 12/13 - commonly used as reference)
const BASE_WIDTH = 390;
const BASE_HEIGHT = 844;

// Scale factor based on screen width
const scale = SCREEN_WIDTH / BASE_WIDTH;

// Tablets: avoid linear scaling (would look like a "zoomed phone"); cap effective scale
const TABLET_NORMALIZE_MAX_SCALE = 1.22;

export const getEffectiveScale = () => {
  if (SCREEN_WIDTH >= 768) {
    return Math.min(scale, TABLET_NORMALIZE_MAX_SCALE);
  }
  return scale;
};

// Normalize function for responsive sizing
export const normalize = (size) => {
  const newSize = size * getEffectiveScale();
  if (Platform.OS === 'ios') {
    return Math.round(PixelRatio.roundToNearestPixel(newSize));
  } else {
    return Math.round(PixelRatio.roundToNearestPixel(newSize)) - 2;
  }
};

// Get screen dimensions
export const getScreenDimensions = () => ({
  width: SCREEN_WIDTH,
  height: SCREEN_HEIGHT,
  scale,
});

// Check if device is tablet
export const isTablet = () => {
  return SCREEN_WIDTH >= 768;
};

// Check if device is small screen
export const isSmallScreen = () => {
  return SCREEN_WIDTH < 360;
};

// Check if device is large screen
export const isLargeScreen = () => {
  return SCREEN_WIDTH > 414;
};

// Responsive font sizes
export const fontSize = {
  xs: normalize(10),
  sm: normalize(12),
  base: normalize(14),
  md: normalize(16),
  lg: normalize(18),
  xl: normalize(20),
  '2xl': normalize(24),
  '3xl': normalize(30),
  '4xl': normalize(36),
};

// Responsive spacing
export const spacing = {
  xs: normalize(4),
  sm: normalize(8),
  md: normalize(12),
  base: normalize(16),
  lg: normalize(20),
  xl: normalize(24),
  '2xl': normalize(32),
  '3xl': normalize(40),
  '4xl': normalize(48),
};

// Responsive icon sizes
export const iconSize = {
  xs: normalize(12),
  sm: normalize(16),
  md: normalize(20),
  lg: normalize(24),
  xl: normalize(32),
  '2xl': normalize(40),
  '3xl': normalize(48),
  '4xl': normalize(64),
};

// Responsive component sizes
export const componentSize = {
  buttonHeight: normalize(44),
  inputHeight: normalize(48),
  cardPadding: normalize(16),
  headerHeight: normalize(56),
  tabBarHeight: normalize(50),
  avatarSmall: normalize(32),
  avatarMedium: normalize(48),
  avatarLarge: normalize(64),
  avatarXLarge: normalize(96),
};

// Get responsive width percentage
export const wp = (percentage) => {
  return (SCREEN_WIDTH * percentage) / 100;
};

// Get responsive height percentage
export const hp = (percentage) => {
  return (SCREEN_HEIGHT * percentage) / 100;
};

// Responsive padding/margin helper
export const responsivePadding = (base = 16) => {
  if (isTablet()) {
    return normalize(base * 1.5);
  }
  if (isSmallScreen()) {
    return normalize(base * 0.75);
  }
  return normalize(base);
};

// Responsive font helper
export const responsiveFont = (base = 14) => {
  if (isTablet()) {
    return normalize(base * 1.04);
  }
  if (isSmallScreen()) {
    return normalize(base * 0.9);
  }
  return normalize(base);
};

/** Dashboard / hero title: slightly smaller on tablet so it does not dominate */
export const dashboardTitleFont = (base = 20) => {
  if (isTablet()) {
    return normalize(Math.min(base, 18));
  }
  return responsiveFont(base);
};

/** Multi-column grids on tablet: 2 cols from 768px, 3 cols from 1024px. */
export const getTabletGridColumns = (largeBreakpoint = 1024) => {
  if (SCREEN_WIDTH < 768) return 1;
  if (SCREEN_WIDTH >= largeBreakpoint) return 3;
  return 2;
};

/**
 * Login / narrow content column on tablet (500–700pt width cap).
 * Returns max width in px; undefined when not tablet.
 */
export const getTabletNarrowContentMaxWidth = (min = 500, max = 700) => {
  if (!isTablet()) return undefined;
  const horizontalGutter = normalize(48);
  const target = Math.min(max, Math.max(min, SCREEN_WIDTH * 0.58));
  return Math.min(target, SCREEN_WIDTH - horizontalGutter);
};

// Responsive width with max constraint
export const responsiveWidth = (base, max = null) => {
  const width = normalize(base);
  if (max && width > max) {
    return max;
  }
  return width;
};

// Responsive height with max constraint
export const responsiveHeight = (base, max = null) => {
  const height = normalize(base);
  if (max && height > max) {
    return max;
  }
  return height;
};

// Get number of columns for grid layouts
export const getColumns = (baseColumns = 2) => {
  if (isTablet()) {
    return baseColumns * 2;
  }
  if (isSmallScreen()) {
    return Math.max(1, baseColumns - 1);
  }
  return baseColumns;
};

export default {
  normalize,
  getEffectiveScale,
  getScreenDimensions,
  isTablet,
  isSmallScreen,
  isLargeScreen,
  fontSize,
  spacing,
  iconSize,
  componentSize,
  wp,
  hp,
  responsivePadding,
  responsiveFont,
  dashboardTitleFont,
  getTabletNarrowContentMaxWidth,
  getTabletGridColumns,
  responsiveWidth,
  responsiveHeight,
  getColumns,
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  scale,
};


