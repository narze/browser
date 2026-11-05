<script lang="ts">
  export let name: string;
  export let size = 18;
  const paths: Record<string, string> = {
    command: 'M9 7V5a2 2 0 1 0-2 2h10a2 2 0 1 0-2-2v14a2 2 0 1 0 2-2H7a2 2 0 1 0 2 2V7',
    split: 'M4 4h16v16H4z M12 4v16',
    settings: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
    back: 'm14 6-6 6 6 6',
    forward: 'm10 6 6 6-6 6',
    reload: 'M20 7v5h-5 M20 12a8 8 0 1 0-2.3 5.7 M20 7l-2.3-2.3',
    close: 'm7 7 10 10 M17 7 7 17',
    plus: 'M12 5v14 M5 12h14',
    search: 'M21 21l-4.4-4.4 M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3c5 5 5 13 0 18 M12 3c-5 5-5 13 0 18',
    home: 'm3 10 9-7 9 7 M5 9v12h14V9 M9 21v-8h6v8',
    arrow: 'M5 12h14 m-5-5 5 5-5 5',
    shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3 M8 12l3 3 5-6',
    code: 'm8 7-5 5 5 5 m8-10 5 5-5 5 M14 4l-4 16',
    pin: 'M9 4h6 M10 4v6l-3 4h10l-3-4V4 M12 14v7',
    star: 'm12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z',
    edit: 'M4 20h4L19 9l-4-4L4 16z M13 7l4 4',
    folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    folderOpen: 'M3 17V7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1.5 M3 17l2.5-5.8A2 2 0 0 1 7.3 10H20a1 1 0 0 1 .9 1.4l-2.6 6.4a2 2 0 0 1-1.9 1.2H5a2 2 0 0 1-2-2z',
    archive: 'M3 5h18v4H3z M5 9v10h14V9 M10 13h4',
    chevron: 'm9 6 6 6-6 6',
    space: 'm12 3 9 5-9 5-9-5z M3 13l9 5 9-5',
    splitRows: 'M4 4h16v16H4z M4 12h16',
    splitGrid: 'M4 4h16v16H4z M12 4v16 M4 12h16',
    addPane: 'M4 4h10v16H4z M18 9v6 M15 12h6',
    compact: 'M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5',
  };
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d={paths[name] || paths.globe} />
</svg>
