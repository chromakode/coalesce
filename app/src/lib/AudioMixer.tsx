export interface TrackMixerState {
  gain?: number
}

export interface MixerState {
  tracks: Record<string, TrackMixerState>
}

export interface AudioMixer {
  getTrackDestination(trackId: string): AudioNode | null
  destroy(): void
}

export class RawOutputMixer implements AudioMixer {
  destNode: GainNode

  constructor(ctx: AudioContext | OfflineAudioContext, destination: AudioNode) {
    this.destNode = ctx.createGain()
    this.destNode.connect(destination)
  }

  getTrackDestination(): AudioNode {
    return this.destNode
  }

  destroy(): void {
    this.destNode.disconnect()
  }
}

export class EditorOutputMixer implements AudioMixer {
  ctx: AudioContext | OfflineAudioContext
  destination: AudioNode | null
  settings: MixerState
  trackOutputs: Map<string, GainNode> = new Map()

  constructor(
    ctx: AudioContext | OfflineAudioContext,
    destination: AudioNode,
    settings: MixerState,
  ) {
    this.ctx = ctx
    this.destination = destination
    this.settings = settings
  }

  getTrackDestination(trackId: string): AudioNode | null {
    if (this.destination === null) {
      return null
    }

    const existingOutupt = this.trackOutputs.get(trackId)
    if (existingOutupt) {
      return existingOutupt
    }

    const gainNode = this.ctx.createGain()
    const gain = this.settings.tracks[trackId]?.gain ?? 1
    gainNode.gain.value = gain
    gainNode.connect(this.destination)
    this.trackOutputs.set(trackId, gainNode)

    return gainNode
  }

  updateMixerSettings(update: MixerState) {
    for (const [trackId, trackMixerSettings] of Object.entries(update.tracks)) {
      const gainNode = this.trackOutputs.get(trackId)
      if (gainNode) {
        const gain = trackMixerSettings.gain ?? 1
        if (gainNode.gain.value != gain) {
          gainNode.gain.value = gain
        }
      }
    }
    this.settings = update
  }

  destroy(): void {
    for (const gainNode of this.trackOutputs.values()) {
      gainNode.disconnect()
    }
    this.destination = null
  }
}
