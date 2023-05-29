import { RefObject, useEffect, useRef, useState } from 'react'
import WaveSurfer, { WaveSurferOptions } from 'wavesurfer.js'
import RegionsPlugin, {
  Region,
  RegionParams,
} from 'wavesurfer.js/dist/plugins/regions'

export type UseWaveSurferOptions = Omit<WaveSurferOptions, 'container'> & {
  buffer?: AudioBuffer
  regions?: RegionParams[]
  onRegionUpdated?: (region: Region) => void
}

// via https://wavesurfer-js.org/examples/#react.js
export function useWavesurfer(
  containerRef: RefObject<HTMLDivElement>,
  { buffer, regions, onRegionUpdated, ...options }: UseWaveSurferOptions = {},
) {
  const [wavesurfer, setWavesurfer] = useState<WaveSurfer | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const ws = WaveSurfer.create({
      ...options,
      container: containerRef.current,
      url: 'data:text/plain,test', // Seems to need a string value to display
      peaks: buffer ? [buffer.getChannelData(0)] : undefined,
      duration: buffer?.duration,
      sampleRate: buffer?.sampleRate,
    })

    setWavesurfer(ws)

    return () => {
      ws.destroy()
    }
  }, [buffer, containerRef])

  useEffect(() => {
    if (!wavesurfer || !regions) {
      return
    }

    const wsRegions = wavesurfer.registerPlugin(RegionsPlugin.create())
    for (const r of regions) {
      wsRegions.addRegion(r)
    }

    if (onRegionUpdated) {
      const listener = wsRegions.on('region-updated', onRegionUpdated)
      return () => {
        wsRegions.un('region-updated', listener)
      }
    }
  }, [wavesurfer, regions])

  return wavesurfer
}

export function WaveEditor(options: UseWaveSurferOptions) {
  const containerRef = useRef<HTMLDivElement>(null)
  useWavesurfer(containerRef, options)

  return <div className="wave-container" ref={containerRef} />
}
