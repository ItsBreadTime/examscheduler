<script lang="ts">
  let { name, size = 20 }: { name: string; size?: number } = $props();
  const paths: Record<string, string> = {
    calendar: 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2m2 10h2m4 0h2m-8 4h2',
    upload: 'M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5',
    file: 'M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8m-8 4h8',
    review: 'M9 5h11M9 12h11M9 19h11M3 5l1 1 2-3M3 12l1 1 2-3M3 19l1 1 2-3',
    overview: 'M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z',
    table: 'M3 4h18v16H3ZM3 9h18M9 9v11M3 14h18',
    groups: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8m6 10v-2a4 4 0 0 0-3-3.87M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
    alert: 'm12 3 10 18H2L12 3Zm0 6v5m0 3v.1',
    arrow: 'M4 12h16m-6-6 6 6-6 6',
    check: 'm5 12 4 4L19 6',
    close: 'm6 6 12 12M6 18 18 6',
    search: 'M21 21l-5-5M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z',
    lock: 'M6 11h12v10H6Zm2 0V7a4 4 0 0 1 8 0v4m-4 4v2',
    edit: 'm16 3 5 5-12 12-6 1 1-6L16 3Zm-3 3 5 5',
    download: 'M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5',
    menu: 'M3 6h18M3 12h18M3 18h18',
    info: 'M12 11v6m0-10v.1M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z',
    cloud: 'M7 18a4 4 0 0 1-.6-7.95A6 6 0 0 1 18.3 9.1 3.5 3.5 0 0 1 17.5 18H7Zm5-3v-4m0 0-2 2m2-2 2 2',
    link: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1.5 1.5M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1.5-1.5',
    copy: 'M9 9h10v12H9Zm0 0V5h10v4M5 5v12h4',
  };
  $effect(() => { if (!paths[name]) console.warn(`Unknown icon name: ${name}`); });
</script>
<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.info} /></svg>
