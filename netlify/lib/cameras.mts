// What it really looks like outside: a still from a public webcam, for him to look at.
// The pictures come from Windy Webcams (api.windy.com, a free key); each camera is listed there by number.

export type Cameras = { key: string; list: { id: string; name: string }[] };
export type View = { text: string; image?: { media_type: "image/jpeg" | "image/png" | "image/webp"; data: string } };

/** Jezioro Tarnobrzeskie and Sandomierz, as listed on windy.com/webcams. ALAN_WEBCAMS replaces the list: "id:name, id:name". */
export const DEFAULT_CAMERAS = "1722352893:Jezioro Tarnobrzeskie w Tarnobrzegu, 1306880639:Sandomierz";

export const parseCameras = (list: string) => list.split(",").map((one) => one.trim().match(/^(\d+)\s*:\s*(.+)$/)).filter(Boolean).map((m) => ({ id: m![1], name: m![2].trim() }));

const KINDS = ["image/jpeg", "image/png", "image/webp"] as const;

/** The newest still of the camera whose name fits `where` (the first one otherwise). */
export async function lookOutside(cameras: Cameras, where: string, now: Date, fetcher: typeof fetch = fetch): Promise<View> {
  const wanted = where.trim().toLowerCase().slice(0, 5);
  const camera = cameras.list.find((c) => wanted && c.name.toLowerCase().includes(wanted)) ?? cameras.list[0];
  if (!camera) return { text: "Błąd: nie masz żadnej kamery." };
  try {
    const res = await fetcher(`https://api.windy.com/webcams/api/v3/webcams/${camera.id}?include=images`, { headers: { "x-windy-api-key": cameras.key }, signal: AbortSignal.timeout(6000) });
    if (res.status === 401 || res.status === 403) return { text: `Błąd: Windy nie przyjmuje klucza WINDY_API_KEY (${res.status}); Kuba musi go sprawdzić.` };
    if (!res.ok) return { text: `Błąd: kamera ${camera.name} nie odpowiada (${res.status}).` };
    const info = await res.json();
    const url = info.images?.current?.preview ?? info.images?.daylight?.preview;
    if (typeof url !== "string" || !url.startsWith("https://")) return { text: `Błąd: kamera ${camera.name} nie ma teraz obrazu.` };
    const picture = await fetcher(url, { signal: AbortSignal.timeout(6000) });
    const kind = KINDS.find((k) => (picture.headers.get("content-type") ?? "").startsWith(k));
    const bytes = picture.ok ? Buffer.from(await picture.arrayBuffer()) : null;
    if (!bytes || !kind || bytes.length > 3_000_000) return { text: `Błąd: nie udało się pobrać obrazu z kamery ${camera.name}.` };
    const minutes = info.lastUpdatedOn ? Math.round((now.getTime() - new Date(info.lastUpdatedOn).getTime()) / 60000) : NaN;
    const age = !Number.isFinite(minutes) ? "" : minutes > 180 ? " Uwaga: obraz jest sprzed kilku godzin, kamera mogła stanąć." : ` Obraz sprzed ${Math.max(1, minutes)} min.`;
    return { text: `Kamera: ${camera.name}.${age} Opisz własnymi słowami, co widać: niebo, deszcz, śnieg, mgłę, mokrą ziemię, czy jest jasno. Nie wymyślaj tego, czego na obrazie nie ma.`,
      image: { media_type: kind, data: bytes.toString("base64") } };
  } catch (err) {
    return { text: `Błąd: kamera ${camera.name} nie odpowiada (${(err as Error).message}).` };
  }
}
