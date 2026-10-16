"use client"

import { useSyncExternalStore } from "react"

/**
 * Foreground GPS mileage tracker. Browsers only report location while the page
 * is open, so we hold a screen wake lock during a trip. Progress is persisted to
 * localStorage so a reload or accidental tab switch resumes the same trip.
 */

export type Trip = { startedAt: number; meters: number }

const KEY = "flipledger.gpsTrip"
const METERS_PER_MILE = 1609.344
const MAX_ACCURACY_M = 50 // ignore fixes worse than this
const MAX_SPEED_MS = 70 // ~155 mph: anything faster is a GPS jump

let trip: Trip | null = read()
let error: string | null = null
let watchId: number | null = null
let last: { lat: number; lon: number; t: number } | null = null
let wakeLock: WakeLockSentinel | null = null
const listeners = new Set<() => void>()
let snapshot: { trip: Trip | null; error: string | null } = { trip, error }

function read(): Trip | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Trip) : null
  } catch {
    return null
  }
}

function emit() {
  snapshot = { trip, error }
  try {
    if (trip) localStorage.setItem(KEY, JSON.stringify(trip))
    else localStorage.removeItem(KEY)
  } catch {
    // storage unavailable (private mode); tracking still works in memory
  }
  listeners.forEach((l) => l())
}

function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function onPosition(pos: GeolocationPosition) {
  if (!trip) return
  const { latitude: lat, longitude: lon, accuracy } = pos.coords
  if (accuracy > MAX_ACCURACY_M) return
  const here = { lat, lon, t: pos.timestamp }
  if (!last) {
    last = here
    return
  }
  const d = haversine(last, here)
  // Ignore jitter while parked: only count moves larger than the fix's own error.
  if (d < Math.max(10, accuracy / 2)) return
  const secs = Math.max(1, (here.t - last.t) / 1000)
  last = here
  if (d / secs > MAX_SPEED_MS) return
  trip = { ...trip, meters: trip.meters + d }
  if (error) error = null
  emit()
}

function onError(e: GeolocationPositionError) {
  error =
    e.code === e.PERMISSION_DENIED
      ? "Location permission is off. Allow location for this site in your browser settings."
      : "Can't get a GPS signal right now. Keep the app open and try moving outside."
  emit()
}

async function holdWakeLock() {
  try {
    wakeLock = (await navigator.wakeLock?.request("screen")) ?? null
  } catch {
    wakeLock = null
  }
}

function startWatch() {
  if (watchId !== null) return
  last = null
  watchId = navigator.geolocation.watchPosition(onPosition, onError, {
    enableHighAccuracy: true,
    maximumAge: 5_000,
    timeout: 30_000,
  })
  void holdWakeLock()
}

function stopWatch() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId)
  watchId = null
  last = null
  void wakeLock?.release().catch(() => {})
  wakeLock = null
}

export function gpsSupported() {
  return typeof window !== "undefined" && window.isSecureContext && "geolocation" in navigator
}

export function startTrip() {
  error = null
  trip = { startedAt: Date.now(), meters: 0 }
  emit()
  startWatch()
}

/** Ends the trip and returns it; the caller decides whether to save it. */
export function endTrip(): Trip | null {
  const ended = trip
  stopWatch()
  trip = null
  error = null
  emit()
  return ended
}

/** Re-attach the GPS watch to a trip restored from storage (after reload). */
export function resumeTrip() {
  if (trip && gpsSupported()) startWatch()
}

export function tripMiles(t: Trip) {
  return t.meters / METERS_PER_MILE
}

function subscribe(l: () => void) {
  listeners.add(l)
  // Wake locks are dropped when the page is hidden; re-acquire on return.
  const onVisible = () => document.visibilityState === "visible" && trip && void holdWakeLock()
  document.addEventListener("visibilitychange", onVisible)
  return () => {
    listeners.delete(l)
    document.removeEventListener("visibilitychange", onVisible)
  }
}

const serverSnapshot: typeof snapshot = { trip: null, error: null }

export function useGpsTrip() {
  return useSyncExternalStore(subscribe, () => snapshot, () => serverSnapshot)
}
