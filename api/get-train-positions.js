// File: api/get-train-positions.js
// Versi FINAL DEFINITIF: Disesuaikan untuk format Vercel

const fs = require("fs/promises");
const path = require("path");

// --- Bagian 1: Fungsi-Fungsi Pembantu (tidak ada perubahan) ---
function getGapekaTimeInMinutes(d) { return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 }
function parseTimeToMinutesOnly(t) { if (!t) return null; const p = t.split(":"); if (p.length < 2) return null; const h = parseInt(p[0], 10), m = parseInt(p[1], 10); return isNaN(h) || isNaN(m) ? null : h * 60 + m }
function haversineDistance(s, t) { const e = 6371e3, n = s.lat * Math.PI / 180, o = t.lat * Math.PI / 180, a = (t.lat - s.lat) * Math.PI / 180, r = (t.lon - s.lon) * Math.PI / 180, i = Math.sin(a / 2) * Math.sin(a / 2) + Math.cos(n) * Math.cos(o) * Math.sin(r / 2) * Math.sin(r / 2), l = 2 * Math.atan2(Math.sqrt(i), Math.sqrt(1 - i)); return e * l }
function getPointOnPolyline(s, t) { if (!s || s.length < 2) return null; let e = 0; for (let n = 0; n < s.length - 1; n++)e += haversineDistance({ lat: s[n][0], lon: s[n][1] }, { lat: s[n + 1][0], lon: s[n + 1][1] }); if (0 === e) return s[0]; const n = e * t; let o = 0; for (let a = 0; a < s.length - 1; a++) { const r = s[a], i = s[a + 1], l = haversineDistance({ lat: r[0], lon: r[1] }, { lat: i[0], lon: i[1] }); if (o + l >= n) { const c = n - o, u = 0 === l ? 0 : c / l; return [r[0] + (i[0] - r[0]) * u, r[1] + (i[1] - r[1]) * u] } o += l } return s[s.length - 1] }

// --- Bagian 2: Fungsi Kalkulasi Status Kereta (tidak ada perubahan) ---
// GANTI SELURUH FUNGSI LAMA DENGAN FUNGSI BARU INI
function calculateTrainStatus(trainData, precomputedRoutes, gapekaNow) {
    const { nomor_ka, nama_kereta, jadwal_perhentian } = trainData;
    const nowMinutes = getGapekaTimeInMinutes(gapekaNow);

    if (!jadwal_perhentian || jadwal_perhentian.length < 2) {
        return { onTrip: false };
    }

    for (let i = 0; i < jadwal_perhentian.length - 1; i++) {
        const currentStop = jadwal_perhentian[i];
        const nextStop = jadwal_perhentian[i + 1];

        let depTime = parseTimeToMinutesOnly(currentStop.berangkat);
        let arrTime = parseTimeToMinutesOnly(nextStop.datang === "Ls" ? nextStop.berangkat : nextStop.datang);

        if (depTime === null || arrTime === null) {
            continue;
        }

        // Logika untuk perjalanan semalam (overnight)
        const isOvernight = arrTime < depTime;
        const isNowInOvernightSpan = nowMinutes >= depTime || nowMinutes < arrTime;
        const isNowInDaytimeSpan = nowMinutes >= depTime && nowMinutes < arrTime;

        // Cek apakah waktu 'now' berada dalam rentang segmen ini
        if ((isOvernight && isNowInOvernightSpan) || (!isOvernight && isNowInDaytimeSpan)) {
            
            // LOGIKA BARU: Hitung progres hanya di segmen aktif ini
            let segmentDuration = isOvernight ? (1440 - depTime) + arrTime : arrTime - depTime;
            let timeIntoSegment = isOvernight ? (nowMinutes >= depTime ? nowMinutes - depTime : (1440 - depTime) + nowMinutes) : nowMinutes - depTime;
            
            const progressInSegment = segmentDuration > 0 ? timeIntoSegment / segmentDuration : 0;
            
            // Ambil rute untuk kereta ini
            const trainRoute = precomputedRoutes[nomor_ka];
            if (!trainRoute) continue; // Lanjut jika rute tidak ditemukan

            // Dapatkan posisi di polyline menggunakan progres keseluruhan (ini masih oke)
            const firstDepartureMinutes = parseTimeToMinutesOnly(jadwal_perhentian[0].berangkat);
            let lastArrivalTime = parseTimeToMinutesOnly(jadwal_perhentian[jadwal_perhentian.length - 1].datang === "Ls" ? jadwal_perhentian[jadwal_perhentian.length - 1].berangkat : jadwal_perhentian[jadwal_perhentian.length - 1].datang);
            
            if (firstDepartureMinutes === null || lastArrivalTime === null) continue;

            let lastArrivalTimeAdjusted = lastArrivalTime < firstDepartureMinutes ? lastArrivalTime + 1440 : lastArrivalTime;
            const totalTripDuration = lastArrivalTimeAdjusted - firstDepartureMinutes;
            
            let nowMinutesAdjusted = nowMinutes < firstDepartureMinutes ? nowMinutes + 1440 : nowMinutes;
            const timeSinceFirstDeparture = nowMinutesAdjusted - firstDepartureMinutes;
            const overallProgress = totalTripDuration > 0 ? timeSinceFirstDeparture / totalTripDuration : 0;

            const calculatedPos = getPointOnPolyline(trainRoute, Math.min(1, Math.max(0, overallProgress)));

            if (calculatedPos) {
                return { onTrip: true, id: nomor_ka, nama: nama_kereta, lat: calculatedPos[0], lon: calculatedPos[1] };
            }
        }
    }

    return { onTrip: false };
}

// --- Bagian 3: Handler Utama Vercel Function (KODE BARU) ---
export default async function handler(request, response) {
    try {
        // PERUBAHAN 1: Path ke file data disesuaikan untuk Vercel
        const dataPath = path.resolve(process.cwd(), "data");
        const routesPath = path.join(dataPath, "precomputed-routes.json");
        const schedulePath = path.join(dataPath, "jadwal_kereta.json");

        const routesData = await fs.readFile(routesPath, "utf-8");
        const schedulesData = await fs.readFile(schedulePath, "utf-8");

        const precomputedRoutes = JSON.parse(routesData);
        const allTrainSchedules = JSON.parse(schedulesData);

        const nowUTC = new Date();
        // const gapekaNow = new Date(nowUTC.getTime() + 7 * 60 * 60 * 1000);
        const gapekaNow = new Date('2025-06-08T09:12:00.000+07:00')

        const activeTrains = allTrainSchedules
            .map((trainData) => calculateTrainStatus(trainData, precomputedRoutes, gapekaNow))
            .filter((p) => p.onTrip);

        // PERUBAHAN 2: Cara mengirim response disesuaikan untuk Vercel
        response.setHeader('Access-Control-Allow-Origin', '*'); // Header untuk CORS
        response.status(200).json(activeTrains);

    } catch (error) {
        console.error("Function Error:", error); // Tetap log error detail di server
        
        // PERUBAHAN 3: Cara mengirim response error
        response.status(500).json({
            error: "Gagal memproses data di server.",
            message: error.message, // Kirim pesan error saja ke publik
        });
    }
}
