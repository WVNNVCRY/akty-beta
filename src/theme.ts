import type { ThemeConfig } from 'antd';

/**
 * Палитра «графит + разметочный жёлтый».
 * Жёлтый — только для главных действий и активных элементов навигации; текст на жёлтом — тёмный (контраст ≥ 7:1).
 * Ссылки, фокус и выделение — графитово-синие, чтобы текст оставался читаемым на светлом фоне.
 */
export const C = {
  graphite: '#1f252c', // боковое меню
  graphite2: '#272e36', // шапка
  graphiteLine: '#353d47',
  onDark: '#e7ebef',
  onDarkMuted: '#97a3b0',
  accent: '#f5b400', // жёлтый разметки (близок к RAL 1023)
  accentHover: '#ffc629',
  accentActive: '#dda200',
  accentSoft: '#fff4d1',
  accentLine: '#f0d68a',
  onAccent: '#1f252c',
  primary: '#2f4a66', // графитово-синий: выделение, фокус, переключатели
  link: '#1f5f99',
  bg: '#e8ecf0', // фон рабочей области
  surface: '#ffffff',
  panel: '#f3f5f8', // вложенные панели внутри карточек
  panelLine: '#dde3e9',
  head: '#f6f8fa', // заголовки карточек и таблиц
  text: '#1f252c',
  muted: '#5f6b78',
  faint: '#8a95a1',
  important: '#c41d7f',
  importantSoft: '#fff0f6',
  importantLine: '#ffadd2',
};

export const FONT = "'Inter Variable', Inter, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export const theme: ThemeConfig = {
  token: {
    colorPrimary: C.primary,
    colorLink: C.link,
    colorLinkHover: '#2b78bd',
    colorInfo: '#1f6fb2',
    colorSuccess: '#2e8b3d',
    colorWarning: '#d48806',
    colorError: '#cf3a2b',
    colorText: C.text,
    colorTextSecondary: C.muted,
    colorTextTertiary: C.faint,
    colorTextDescription: C.muted,
    colorBorder: '#cfd6de',
    colorBorderSecondary: '#e1e6eb',
    colorBgLayout: C.bg,
    colorFillAlter: C.head,
    fontFamily: FONT,
    fontSize: 14,
    borderRadius: 6,
    borderRadiusLG: 8,
    controlHeight: 34,
    boxShadowTertiary: '0 1px 2px rgba(31,37,44,.06), 0 1px 3px rgba(31,37,44,.05)',
  },
  components: {
    Layout: { headerBg: C.graphite2, siderBg: C.graphite, bodyBg: C.bg, headerHeight: 56, headerPadding: '0 20px' },
    Menu: {
      darkItemBg: C.graphite,
      darkSubMenuItemBg: C.graphite,
      darkItemColor: C.onDarkMuted,
      darkItemHoverColor: '#ffffff',
      darkItemHoverBg: 'rgba(255,255,255,.06)',
      darkItemSelectedBg: C.accent,
      darkItemSelectedColor: C.onAccent,
      itemHeight: 40,
      itemMarginInline: 10,
      itemBorderRadius: 6,
      iconSize: 15,
    },
    Button: {
      colorPrimary: C.accent,
      colorPrimaryHover: C.accentHover,
      colorPrimaryActive: C.accentActive,
      primaryColor: C.onAccent,
      primaryShadow: 'none',
      defaultShadow: 'none',
      dangerShadow: 'none',
      defaultHoverColor: C.text,
      defaultHoverBorderColor: '#8e9aa7',
      defaultActiveColor: C.text,
      defaultActiveBorderColor: '#6b7785',
      fontWeight: 500,
    },
    Card: { headerBg: C.head, headerFontSize: 15, headerHeight: 52, headerHeightSM: 42, colorBorderSecondary: C.panelLine },
    Table: {
      headerBg: '#eef1f5',
      headerColor: '#3a4450',
      headerSplitColor: 'transparent',
      rowHoverBg: '#f6f8fb',
      borderColor: '#e3e8ed',
      footerBg: C.head,
      cellPaddingBlockSM: 6,
    },
    Tabs: { inkBarColor: C.accent, itemSelectedColor: C.text, itemHoverColor: C.text, itemActiveColor: C.text, titleFontSize: 14 },
    Steps: { colorPrimary: C.primary },
    Progress: { defaultColor: C.accent, remainingColor: '#dfe4ea' },
    Statistic: { contentFontSize: 26, titleFontSize: 13 },
    Descriptions: { labelBg: C.head, colorTextSecondary: C.muted },
    Tag: { defaultBg: '#f1f3f6', defaultColor: '#3a4450' },
    Badge: { colorError: '#e5484d' },
    Segmented: { itemSelectedBg: C.surface, trackBg: '#e3e8ed' },
    Collapse: { headerBg: C.head },
    Alert: { withDescriptionPadding: '12px 16px' },
  },
};
