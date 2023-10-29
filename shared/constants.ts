export const TRACK_COLOR_ORDER = [
  'red',
  'green',
  'blue',
  'yellow',
  'purple',
  'orange',
  'teal',
  'cyan',
  'pink',
  'black',
] as const

export enum USER_ROLE {
  OWNER = 'owner',
}

// From https://github.com/guillaumekln/faster-whisper/blob/5a0541ea7d054aa3716ac492491de30158c20057/faster_whisper/transcribe.py#L193-L194
export const BEFORE_PUNCTUATION = '"\'“¿([{-'
export const AFTER_PUNCTUATION = '"\'.。,，!！?？:：”)]}、'
