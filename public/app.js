// File: public/app.js
// Tugas: Hanya untuk menampilkan peta dan data yang diterima dari backend.

document.addEventListener("DOMContentLoaded", () => {
  // 1. Inisialisasi Peta Kosong
  const map = L.map("mapid").setView([-7.2, 110.0], 7); // Zoom ke Jawa
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 18,
  }).addTo(map);

  // Objek untuk menyimpan referensi marker yang sedang tampil di peta
  const trainMarkers = {};
  // Interval untuk meminta data baru (misalnya setiap 15 detik)
  const UPDATE_INTERVAL_MS = 15000;

  // Fungsi sederhana untuk membuat ikon kereta
  function createTrainIcon() {
    return L.icon({
      iconUrl: "train-icon.png",
      iconSize: [25, 25],
      iconAnchor: [12, 12],
    });
  }

  // 2. Fungsi Utama Frontend: Meminta data dan mengupdate peta
  async function updateMap() {
    console.log("Meminta data posisi kereta terbaru dari backend...");
    try {
      // Memanggil backend (Netlify Function) Anda.
      // URL ini secara otomatis akan diarahkan oleh Netlify ke function Anda.
      const response = await fetch('/api/get-train-positions');
      if (!response.ok) {
        throw new Error(`Server error: ${response.statusText}`);
      }

      // Menerima data JSON sederhana dari backend (hanya kereta yang aktif)
      const activeTrains = await response.json();
      console.log(`Menerima data untuk ${activeTrains.length} kereta aktif.`);

      // Objek untuk melacak marker mana yang harus dihapus
      const markersToDelete = { ...trainMarkers };

      // 3. Loop melalui data yang diterima untuk menggambar marker
      activeTrains.forEach((train) => {
        const markerId = `train-${train.id}`;
        const latLng = [train.lat, train.lon];
        const popupContent = `<b>${train.nama}</b><br>(${train.id})`;

        if (trainMarkers[markerId]) {
          // Jika marker sudah ada di peta, cukup pindahkan posisinya
          trainMarkers[markerId].setLatLng(latLng);
          trainMarkers[markerId].getPopup().setContent(popupContent);
          // Tandai bahwa marker ini masih aktif, jangan dihapus
          delete markersToDelete[markerId];
        } else {
          // Jika ini marker baru, buat dan tambahkan ke peta
          const newMarker = L.marker(latLng, { icon: createTrainIcon() })
            .addTo(map)
            .bindPopup(popupContent);
          trainMarkers[markerId] = newMarker;
        }
      });

      // 4. Hapus marker yang sudah tidak ada di data baru (kereta selesai perjalanan)
      for (const markerId in markersToDelete) {
        map.removeLayer(trainMarkers[markerId]);
        delete trainMarkers[markerId];
      }
    } catch (error) {
      console.error("Gagal mengambil atau memproses data kereta:", error);
    }
  }

  // Jalankan updateMap sekali saat halaman pertama kali dimuat
  updateMap();
  // Atur agar updateMap dijalankan secara berkala
  setInterval(updateMap, UPDATE_INTERVAL_MS);
});
