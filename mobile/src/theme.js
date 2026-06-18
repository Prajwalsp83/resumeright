// Design system for the ResumeRight AI app. Premium dark-navy canvas, gold
// brand accent, plus an "AI" indigo→violet gradient used for AI-specific
// surfaces (the deep-scan, AI badges).
export const colors = {
  bg:       '#0A1424',
  bg2:      '#0E1B30',
  surface:  '#13223B',
  surface2: '#172A47',
  border:   'rgba(255,255,255,0.08)',
  borderGold: 'rgba(232,160,32,0.35)',

  gold:   '#E8A020',
  gold2:  '#F5BC50',

  ai:     '#7C8CFF',
  ai2:    '#8B5CF6',

  white:  '#F8F5EE',
  text:   '#EAF0FA',
  muted:  '#93A4BF',
  faint:  '#5C6E8A',

  green:  '#22C55E',
  red:    '#F87171',
  amber:  '#FBBF24',
};

// Gradients (arrays for expo-linear-gradient).
export const gradients = {
  gold: ['#F5BC50', '#E8A020'],
  ai:   ['#7C8CFF', '#6366F1', '#8B5CF6'],
  hero: ['#13223B', '#0E1B30', '#0A1424'],
  card: ['#16263F', '#111E33'],
};

export const space = { xs: 6, sm: 10, md: 16, lg: 22, xl: 32 };
export const radius = { sm: 10, md: 16, lg: 22, pill: 999 };

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  glow: {
    shadowColor: '#6366F1',
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
};

export const severityColor = {
  critical: '#F87171',
  high:     '#FB923C',
  medium:   '#FBBF24',
  low:      '#93A4BF',
};
