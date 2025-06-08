// File: test-logic.js
// Tujuan: Hanya untuk mengetes logika kalkulasi di komputer lokal.

const fs = require("fs/promises");
const path = require("path");

// --- Bagian 1: Salin-Tempel SEMUA FUNGSI HELPER dari get-train-positions.js ---
function getStationCodeFromString(s){if(!s||"string"!=typeof s)return null;const t=s.match(/\(([^)]+)\)/);return t?t[1]:null}
function getGapekaTimeInMinutes(d){return d.getHours()*60+d.getMinutes()+d.getSeconds()/60}
function parseTimeToMinutesOnly(t){if(!t)return null;const p=t.split(":");if(p.length<2)return null;const h=parseInt(p[0],10),m=parseInt(p[1],10);return isNaN(h)||isNaN(m)?null:h*60+m}
function haversineDistance(s,t){const e=6371e3,n=s.lat*Math.PI/180,o=t.lat*Math.PI/180,a=(t.lat-s.lat)*Math.PI/180,r=(t.lon-s.lon)*Math.PI/180,i=Math.sin(a/2)*Math.sin(a/2)+Math.cos(n)*Math.cos(o)*Math.sin(r/2)*Math.sin(r/2),l=2*Math.atan2(Math.sqrt(i),Math.sqrt(1-i));return e*l}
function getPointOnPolyline(s,t){if(!s||s.length<2)return null;let e=0;for(let n=0;n<s.length-1;n++)e+=haversineDistance({lat:s[n][0],lon:s[n][1]},{lat:s[n+1][0],lon:s[n+1][1]});if(0===e)return s[0];const n=e*t;let o=0;for(let a=0;a<s.length-1;a++){const r=s[a],i=s[a+1],l=haversineDistance({lat:r[0],lon:r[1]},{lat:i[0],lon:i[1]});if(o+l>=n){const c=n-o,u=0===l?0:c/l;return[r[0]+(i[0]-r[0])*u,r[1]+(i[1]-r[1])*u]}o+=l}return s[s.length-1]}

// --- Bagian 2: Salin-Tempel FUNGSI UTAMA KALKULASI dari get-train-positions.js ---
function calculateTrainStatus(trainData, precomputedRoutes, gapekaNow) {
    const { nomor_ka, nama_kereta, jadwal_perhentian } = trainData;
    const nowMinutes = getGapekaTimeInMinutes(gapekaNow);
    if (!jadwal_perhentian || jadwal_perhentian.length < 2) return { onTrip: false };

    // Menggunakan pendekatan menit sejak awal GAPEKA (00:00) untuk robustisitas
    const firstDepartureMinutes = parseTimeToMinutesOnly(jadwal_perhentian[0].berangkat);
    if (firstDepartureMinutes === null) return { onTrip: false };

    for (let i = 0; i < jadwal_perhentian.length - 1; i++) {
        const currentStop = jadwal_perhentian[i];
        const nextStop = jadwal_perhentian[i + 1];

        const departureTime = parseTimeToMinutesOnly(currentStop.berangkat);
        const arrivalTime = parseTimeToMinutesOnly(nextStop.datang === "Ls" ? nextStop.berangkat : nextStop.datang);

        if (departureTime === null || arrivalTime === null) continue;
        
        // Menyesuaikan waktu untuk perjalanan yang melewati tengah malam
        let departureTimeAdjusted = departureTime < firstDepartureMinutes ? departureTime + 1440 : departureTime;
        let arrivalTimeAdjusted = arrivalTime < departureTimeAdjusted ? arrivalTime + 1440 : arrivalTime;
        let nowMinutesAdjusted = nowMinutes < firstDepartureMinutes ? nowMinutes + 1440 : nowMinutes;

        // Cek apakah segmen ini aktif
        if (nowMinutesAdjusted >= departureTimeAdjusted && nowMinutesAdjusted < arrivalTimeAdjusted) {
            const trainRoute = precomputedRoutes[nomor_ka];
            if (!trainRoute) {
                // console.log(`[DEBUG] Rute untuk KA ${nomor_ka} tidak ditemukan di precomputed-routes.`);
                continue;
            }

            const lastStop = jadwal_perhentian[jadwal_perhentian.length - 1];
            const lastArrivalTime = parseTimeToMinutesOnly(lastStop.datang === "Ls" ? lastStop.berangkat : lastStop.datang);
            let lastArrivalTimeAdjusted = lastArrivalTime < firstDepartureMinutes ? lastArrivalTime + 1440 : lastArrivalTime;
            
            const totalTripDuration = lastArrivalTimeAdjusted - firstDepartureMinutes;
            const timeSinceFirstDeparture = nowMinutesAdjusted - firstDepartureMinutes;
            const progress = totalTripDuration > 0 ? timeSinceFirstDeparture / totalTripDuration : 0;
            const calculatedPos = getPointOnPolyline(trainRoute, Math.min(1, Math.max(0, progress)));
            
            if (calculatedPos) {
                // Jika ketemu, langsung cetak log dan kembalikan hasil
                console.log(`[SUCCESS] Ditemukan kereta aktif: KA ${nomor_ka} (${nama_kereta})`);
                return { onTrip: true, id: nomor_ka, nama: nama_kereta };
            }
        }
    }
    return { onTrip: false };
}

// --- Bagian 3: Fungsi untuk Menjalankan Tes ---
async function runTest() {
    try {
        console.log("Memulai tes logika lokal...");

        // Membaca file data yang sama seperti backend
        const dataPath = path.resolve(__dirname, 'data');
        const routesPath = path.join(dataPath, 'precomputed-routes.json');
        const schedulePath = path.join(dataPath, 'jadwal_kereta.json');

        console.log("Membaca file rute...");
        const routesData = await fs.readFile(routesPath, 'utf-8');
        console.log("Membaca file jadwal...");
        const schedulesData = await fs.readFile(schedulePath, 'utf-8');
        
        const precomputedRoutes = JSON.parse(routesData);
        const allTrainSchedules = JSON.parse(schedulesData);

        // Koreksi Zona Waktu ke WIB (UTC+7)
        const nowUTC = new Date();
        const gapekaNow = new Date(nowUTC.getTime() + (7 * 60 * 60 * 1000));
        
        console.log(`\nWaktu saat ini (WIB): ${gapekaNow.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`);
        console.log("--------------------------------------------------");
        console.log("Mencari kereta yang aktif...\n");

        const activeTrains = allTrainSchedules
            .map(trainData => calculateTrainStatus(trainData, precomputedRoutes, gapekaNow))
            .filter(p => p.onTrip);
        
        console.log("--------------------------------------------------");
        if (activeTrains.length > 0) {
            console.log(`HASIL: Ditemukan ${activeTrains.length} kereta aktif!`);
            console.log(activeTrains);
        } else {
            console.log("HASIL: Tidak ada kereta aktif yang ditemukan pada waktu ini.");
            console.log("Ini berarti ada masalah pada logika `calculateTrainStatus` atau ketidakcocokan dengan format data `jadwal_kereta.json`.");
        }
        console.log("\nTes selesai.");

    } catch (error) {
        console.error("\n!!! TERJADI ERROR SAAT TES LOKAL !!!");
        console.error(error);
    }
}

// Jalankan tesnya!
runTest();