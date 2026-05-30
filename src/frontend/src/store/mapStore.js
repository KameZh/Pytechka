import { create } from 'zustand'

export const useMapStore = create((set) => ({
  mode: 'explore',

  selectedTrail: null,

  mapStyle: 'outdoors-v12',

  terrain3D: false,

  hillshadeRelief: false,

  trailsVersion: 0,

  setMode: (mode) => set({ mode }),
  setSelectedTrail: (trail) => set({ selectedTrail: trail }),
  setMapStyle: (style) => set({ mapStyle: style }),
  toggleTerrain: () => set((s) => ({ terrain3D: !s.terrain3D })),
  toggleHillshadeRelief: () =>
    set((s) => ({ hillshadeRelief: !s.hillshadeRelief })),
  toggleMapStyle: () =>
    set((s) => ({
      mapStyle:
        s.mapStyle === 'outdoors-v12'
          ? 'satellite-streets-v12'
          : 'outdoors-v12',
    })),
  huts: [],
  setHuts: (huts) => set({ huts }),
  selectedHut: null,
  setSelectedHut: (hut) => set({ selectedHut: hut }),
}))
