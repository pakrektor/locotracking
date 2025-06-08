// File: precompute.js (Versi Lengkap dan Sudah Diperbaiki)

const fs = require("fs/promises");
const path = require("path");

// --- Fungsi Helper ---
function getStationCodeFromString(s){if(!s||"string"!=typeof s)return null;const t=s.match(/\(([^)]+)\)/);return t?t[1]:null}
function haversineDistance(s,t){const e=6371e3,n=s.lat*Math.PI/180,o=t.lat*Math.PI/180,a=(t.lat-s.lat)*Math.PI/180,r=(t.lon-s.lon)*Math.PI/180,i=Math.sin(a/2)*Math.sin(a/2)+Math.cos(n)*Math.cos(o)*Math.sin(r/2)*Math.sin(r/2),l=2*Math.atan2(Math.sqrt(i),Math.sqrt(1-i));return e*l}

async function main() {
    console.log("Starting pre-computation of all train routes...");
    console.time("PrecomputationTime");

    // 1. Load semua data mentah
    const dataPath = path.resolve(__dirname, 'data');
    const schedulesData = await fs.readFile(path.join(dataPath, 'jadwal_kereta.json'), 'utf-8');
    const stationsData = await fs.readFile(path.join(dataPath, 'stasiun_data.json'), 'utf-8');
    const railDataRaw = await fs.readFile(path.join(dataPath, 'jalur_rel_jawa.json'), 'utf-8');

    const allTrainSchedules = JSON.parse(schedulesData);
    const stationDataGlobal = JSON.parse(stationsData);
    const allRailData = JSON.parse(railDataRaw);

    // 2. Bangun jaringan rel sekali saja
    const nodeCoordinateMap = new Map();
    const railNetwork = new Map();
    for (const way of allRailData.elements) {
        if (way.type === "way" && way.geometry) {
            for (let i = 0; i < way.nodes.length; i++) {
                if (!nodeCoordinateMap.has(way.nodes[i])) {
                    nodeCoordinateMap.set(way.nodes[i], way.geometry[i]);
                }
            }
        }
    }
    for (const way of allRailData.elements) {
        if (way.type === "way" && way.nodes && way.nodes.length > 1) {
            for (let i = 0; i < way.nodes.length; i++) {
                const currentNodeId = way.nodes[i];
                if (!railNetwork.has(currentNodeId)) railNetwork.set(currentNodeId, new Set());
                if (i > 0) railNetwork.get(currentNodeId).add(way.nodes[i - 1]);
                if (i < way.nodes.length - 1) railNetwork.get(currentNodeId).add(way.nodes[i + 1]);
            }
        }
    }
    console.log("Rail network built.");

    // --- FUNGSI-FUNGSI YANG HILANG SEKARANG DITAMBAHKAN DI SINI ---
    
    // Fungsi untuk mencari node rel terdekat dari sebuah stasiun
    function findClosestRailNode(stationCoords) {
        let closestNodeId = null;
        let minDistance = Infinity;
        for (const [nodeId, nodeCoords] of nodeCoordinateMap.entries()) {
            const distance = haversineDistance(stationCoords, nodeCoords);
            if (distance < minDistance) {
                minDistance = distance;
                closestNodeId = nodeId;
            }
        }
        return minDistance < 2000 ? closestNodeId : null;
    }

    // Fungsi pathfinding (Dijkstra)
    const pathCache = new Map();
    function findShortestPath(startNodeId, endNodeId) {
        const cacheKey = `${startNodeId}-${endNodeId}`;
        if (pathCache.has(cacheKey)) return pathCache.get(cacheKey);
        let distances = new Map(), prev = new Map(), pq = new Set([startNodeId]);
        distances.set(startNodeId, 0);
        while (pq.size > 0) {
            let closestNodeId = null;
            pq.forEach(nodeId => {
                if (closestNodeId === null || distances.get(nodeId) < distances.get(closestNodeId)) {
                    closestNodeId = nodeId;
                }
            });
            if (closestNodeId === endNodeId) {
                const path = []; let currentNode = endNodeId;
                while (currentNode) { path.unshift(currentNode); currentNode = prev.get(currentNode); }
                pathCache.set(cacheKey, path); return path;
            }
            if (closestNodeId === null) break;
            pq.delete(closestNodeId);
            const currentDistance = distances.get(closestNodeId) || Infinity;
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
        pathCache.set(cacheKey, null); return null;
    }

    // 4. Hitung dan gabungkan rute untuk semua kereta
    const allComputedRoutes = {};
    for (const trainData of allTrainSchedules) {
        const fullPath = [];
        const schedule = trainData.jadwal_perhentian;
        if (!schedule || schedule.length < 2) continue;
        
        for (let i = 0; i < schedule.length - 1; i++) {
            const fromCode = getStationCodeFromString(schedule[i].stasiun_perhentian);
            const toCode = getStationCodeFromString(schedule[i+1].stasiun_perhentian);
            const fromStation = stationDataGlobal[fromCode];
            const toStation = stationDataGlobal[toCode];
            if (!fromStation || !toStation) continue;

            // Baris inilah yang tadinya error karena findClosestRailNode tidak ada
            const startNode = findClosestRailNode(fromStation);
            const endNode = findClosestRailNode(toStation);
            if (!startNode || !endNode) continue;

            const pathNodeIds = findShortestPath(startNode, endNode);
            if (pathNodeIds) {
                const segmentPath = pathNodeIds.map(nodeId => {
                    const coords = nodeCoordinateMap.get(nodeId);
                    return [coords.lat, coords.lon];
                });
                fullPath.push(...(fullPath.length > 0 ? segmentPath.slice(1) : segmentPath));
            }
        }
        if (fullPath.length > 0) {
            allComputedRoutes[trainData.nomor_ka] = fullPath;
        }
        console.log(`Route computed for KA ${trainData.nomor_ka}`);
    }

    // 5. Simpan hasilnya ke sebuah file JSON baru di dalam folder data
    const outputPath = path.resolve(__dirname, 'data', 'precomputed-routes.json');
    await fs.writeFile(outputPath, JSON.stringify(allComputedRoutes));
    
    console.timeEnd("PrecomputationTime");
    console.log(`Precomputation finished. Output saved to ${outputPath}`);
}

main();