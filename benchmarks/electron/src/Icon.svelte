<script lang="ts">
  export let name: string;
  export let size = 18;
  const paths: Record<string, string> = {
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
  };
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d={paths[name] || paths.globe} />
</svg>
