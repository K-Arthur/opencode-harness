let _maxConcurrentStreams = 5

export function setMaxConcurrentStreams(max: number): void {
  if (max >= 1 && max <= 10) _maxConcurrentStreams = max
}

export function getMaxConcurrentStreams(): number {
  return _maxConcurrentStreams
}
