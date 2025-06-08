// File: precompute.js
// Tugas: Menjalankan semua kalkulasi berat satu kali untuk menghasilkan file rute
// yang siap pakai dan efisien untuk server.

const fs = require("fs/promises");
const path = require("path");

// --- Fungsi Helper ---
function getStationCodeFromString(s) {
    if (!s || typeof s !== "string") return null;
    const match = s.match(/\(([^)]+)\)/); // Mengambil kode dari dalam kurung, contoh: "Gambir (GMR)" -> "GMR"
    return match ? match[1] : null;
}

function haversineDistance(coords1, coords2) {
    const R = 6371e3; // meter
    const phi1 = coords1.lat * Math.PI / 180;
    const phi2 = coords2.lat * Math.PI / 180;
    const deltaPhi = (coords2.lat - coords1.lat) * Math.PI / 180;
    const deltaLambda = (coords2.lon - coords1.lon) * Math.PI / 180;
    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

async function main() {
    console.log("Memulai pra-komputasi semua rute kereta...");
    console.time("Waktu Pra-komputasi");

    try {
        // 1. Muat semua data mentah dari folder /data
        const dataPath = path.resolve(__dirname, 'data');
        const schedulesData = await fs.readFile(path.join(dataPath, 'jadwal_kereta.json'), 'utf-8');
        const stationsData = await fs.readFile(path.join(dataPath, 'stasiun_data.json'), 'utf-8');
        const railDataRaw = await fs.readFile(path.join(dataPath, 'jalur_rel_jawa.json'), 'utf-8');

        const allTrainSchedules = JSON.parse(schedulesData);
        const stationDataGlobal = JSON.parse(stationsData);
        const allRailData = JSON.parse(railDataRaw);
        console.log("Semua file data berhasil dimuat.");

        // 2. Bangun peta koordinat node dan jaringan rel dari data mentah
        const nodeCoordinateMap = new Map();
        for (const element of allRailData.elements) {
            if (element.type === "node" && element.lat && element.lon) {
                nodeCoordinateMap.set(element.id, { lat: element.lat, lon: element.lon });
            }
        }

        const railNetwork = new Map(); // Adjacency list untuk graf rel
        for (const element of allRailData.elements) {
            if (element.type === "way" && element.nodes && element.nodes.length > 1) {
                for (let i = 0; i < element.nodes.length; i++) {
                    const currentNodeId = element.nodes[i];
                    if (!railNetwork.has(currentNodeId)) railNetwork.set(currentNodeId, new Set());
                    if (i > 0) railNetwork.get(currentNodeId).add(element.nodes[i - 1]);
                    if (i < element.nodes.length - 1) railNetwork.get(currentNodeId).add(element.nodes[i + 1]);
                }
            }
        }
        console.log(`Jaringan rel dibangun: ${nodeCoordinateMap.size} node, ${railNetwork.size} titik koneksi.`);

        // 3. Definisikan fungsi-fungsi inti untuk pemrosesan rute

        function findClosestRailNode(stationCoords) {
            let closestNodeId = null;
            let minDistance = Infinity;
            // Iterasi melalui semua node rel untuk menemukan yang terdekat dengan stasiun
            for (const [nodeId, nodeCoords] of nodeCoordinateMap.entries()) {
                const distance = haversineDistance(stationCoords, nodeCoords);
                if (distance < minDistance) {
                    minDistance = distance;
                    closestNodeId = nodeId;
                }
            }
            // Hanya terima node jika jaraknya di bawah 2km untuk menghindari kesalahan
            return minDistance < 2000 ? closestNodeId : null;
        }
        
        const pathCache = new Map(); // Cache untuk menyimpan hasil pathfinding agar tidak dihitung ulang
        function findShortestPath(startNodeId, endNodeId) {
            const cacheKey = `${startNodeId}-${endNodeId}`;
            if (pathCache.has(cacheKey)) return pathCache.get(cacheKey);

            let distances = new Map();
            let prev = new Map();
            let pq = new Set([startNodeId]);
            distances.set(startNodeId, 0);

            while (pq.size > 0) {
                let closestNodeId = [...pq].reduce((a, b) => (distances.get(a) < distances.get(b) ? a : b));

                if (closestNodeId === endNodeId) {
                    const path = [];
                    let currentNode = endNodeId;
                    while (currentNode) {
                        path.unshift(currentNode);
                        currentNode = prev.get(currentNode);
                    }
                    pathCache.set(cacheKey, path);
                    return path;
                }
                if (closestNodeId === null) break;
                pq.delete(closestNodeId);

                const currentDistance = distances.get(closestNodeId);
                const neighbors = railNetwork.get(closestNodeId) || new Set();

                for (const neighborId of neighbors) {
                    const distToNeighbor = haversineDistance(nodeCoordinateMap.get(closestNodeId), nodeCoordinateMap.get(neighborId));
                    const newDist = currentDistance + distToNeighbor;
                    if (newDist < (distances.get(neighborId) || Infinity)) {
                        distances.set(neighborId, newDist);
                        prev.set(neighborId, closestNodeId);
                        pq.add(neighborId);
                    }
                }
            }
            pathCache.set(cacheKey, null);
            return null;
        }

        // 4. Proses setiap kereta: hitung dan gabungkan rute untuk seluruh perjalanannya
        const allComputedRoutes = {};
        for (const trainData of allTrainSchedules) {
            const fullPath = [];
            const schedule = trainData.jadwal_perhentian;
            if (!schedule || schedule.length < 2) continue;
            
            console.log(`Memproses rute untuk KA ${trainData.nomor_ka} (${trainData.nama_kereta})...`);
            
            for (let i = 0; i < schedule.length - 1; i++) {
                const fromCode = getStationCodeFromString(schedule[i].stasiun_perhentian);
                const toCode = getStationCodeFromString(schedule[i+1].stasiun_perhentian);
                const fromStation = stationDataGlobal[fromCode];
                const toStation = stationDataGlobal[toCode];

                if (!fromStation || !toStation) {
                    console.warn(`  -> Melewati segmen dari ${fromCode} ke ${toCode}: Data stasiun tidak ditemukan.`);
                    continue;
                }

                const startNode = findClosestRailNode(fromStation);
                const endNode = findClosestRailNode(toStation);
                if (!startNode || !endNode) {
                    console.warn(`  -> Melewati segmen dari ${fromCode} ke ${toCode}: Tidak ditemukan node rel terdekat.`);
                    continue;
                }

                const pathNodeIds = findShortestPath(startNode, endNode);
                if (pathNodeIds) {
                    const segmentPath = pathNodeIds.map(nodeId => {
                        const coords = nodeCoordinateMap.get(nodeId);
                        return [coords.lat, coords.lon];
                    });
                    // Gabungkan path, buang titik pertama jika bukan segmen awal untuk menghindari duplikasi
                    fullPath.push(...(fullPath.length > 0 ? segmentPath.slice(1) : segmentPath));
                } else {
                    console.warn(`  -> Melewati segmen dari ${fromCode} ke ${toCode}: Tidak ditemukan jalur rel.`);
                }
            }

            if (fullPath.length > 0) {
                allComputedRoutes[trainData.nomor_ka] = fullPath;
            }
        }

        // 5. Simpan hasil akhir ke file JSON yang siap pakai
        const outputPath = path.resolve(__dirname, 'data', 'precomputed-routes.json');
        await fs.writeFile(outputPath, JSON.stringify(allComputedRoutes, null, 2)); // `null, 2` untuk pretty-print
        
        console.timeEnd("Waktu Pra-komputasi");
        console.log(`\nPra-komputasi selesai. Total ${Object.keys(allComputedRoutes).length} rute kereta berhasil dibuat.`);
        console.log(`Output disimpan di: ${outputPath}`);

    } catch (error) {
        console.error("\nTerjadi kesalahan fatal saat pra-komputasi:", error);
        console.error("Pastikan file 'jadwal_kereta.json', 'stasiun_data.json', dan 'jalur_rel_jawa.json' ada di dalam folder 'data' dan formatnya benar.");
    }
}

// Jalankan fungsi utama
main();
