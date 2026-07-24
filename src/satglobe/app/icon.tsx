export type IconName = 'search' | 'chevron' | 'layers' | 'clock' | 'bookmark' | 'export' | 'import' | 'close' | 'play' | 'pause' | 'previous' | 'next' | 'focus' | 'info' | 'camera';

const iconPaths: Record<IconName, string> = {
  search: 'M11 4a7 7 0 1 0 4.9 12l4 4 1.1-1.1-4-4A7 7 0 0 0 11 4Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z',
  chevron: 'm9 6 6 6-6 6',
  layers: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 5h-2v6l5 3 1-1.7-4-2.3V7Z',
  bookmark: 'M6 3h12v19l-6-4-6 4V3Zm2 2v13.3l4-2.7 4 2.7V5H8Z',
  export: 'M12 3 7 8l1.4 1.4 2.6-2.6V16h2V6.8l2.6 2.6L17 8l-5-5ZM5 14v6h14v-6h2v8H3v-8h2Z',
  import: 'm12 16 5-5-1.4-1.4-2.6 2.6V3h-2v9.2L8.4 9.6 7 11l5 5ZM5 14v6h14v-6h2v8H3v-8h2Z',
  close: 'm6 6 12 12M18 6 6 18',
  play: 'm8 5 11 7-11 7V5Z',
  pause: 'M7 5h4v14H7V5Zm6 0h4v14h-4V5Z',
  previous: 'M6 5h2v14H6V5Zm12 0v14l-9-7 9-7Z',
  next: 'M16 5h2v14h-2V5ZM6 5l9 7-9 7V5Z',
  focus: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  info: 'M11 10h2v8h-2v-8Zm0-4h2v2h-2V6ZM12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z',
  camera: 'M9 4 7.5 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.5L15 4H9Zm3 4.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
};

/** Renders a compact inline icon from the SatGlobe visual language. */
export function Icon({ name, size = 18 }: Readonly<{ name: IconName; size?: number }>) {
  const strokeOnly = ['chevron', 'layers', 'close', 'focus'].includes(name);

  return (
    <svg aria-hidden="true" className="sg-icon" height={size} viewBox="0 0 24 24" width={size}>
      <path d={iconPaths[name]} fill={strokeOnly ? 'none' : 'currentColor'} stroke={strokeOnly ? 'currentColor' : 'none'} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  );
}
