# Proposal Improvement Bisnis & Strategi Profit Meridian-Next

Dokumen ini berisi proposal peningkatan strategi _taking profit_ dan manajemen risiko untuk meningkatkan akurasi hasil pada proyek `meridian-next`, berdasarkan analisis codebase saat ini.

## 1. Optimasi Strategi Taking Profit (TP)

Sistem memiliki parameter `takeProfitFeePct` di konfigurasi, namun implementasi logika penutupan posisi saat ini masih cenderung statis (mengandalkan `emergencyPriceDropPct` sebagai stop-loss).

### Rekomendasi Peningkatan:

- **Dynamic TP based on Volatility**: Memanfaatkan data volatilitas yang sudah tersedia dari API (di `src/lib/tools/screening.ts`) untuk menentukan target TP yang lebih adaptif.
- **Implementasi Trailing Stop**: Mengunci profit secara otomatis saat harga mulai turun setelah mencapai target tertentu, untuk menghindari pembalikan harga yang tajam.
- **Tiered Profit Taking**: Mengimplementasikan mekanisme _partial withdrawal_ (pengambilan profit bertahap) untuk memaksimalkan potensi _upside_ sambil mengamankan modal.

---

## 2. Analisis Bisnis & Manajemen Risiko

Manajemen posisi sudah memiliki dasar dinamis melalui `computeDeployAmount()`, namun masih bisa ditingkatkan untuk efisiensi modal yang lebih tinggi.

### Rekomendasi Peningkatan:

- **Kelly Criterion Integration**: Mengintegrasikan `win_rate_pct` dari `src/lib/lessons.ts` ke dalam perhitungan ukuran posisi menggunakan formula _Kelly Criterion_ untuk optimasi _risk-to-reward_.
- **Correlation Filter**: Menambahkan filter korelasi sektor pada `src/lib/tools/executor.ts` untuk memastikan diversifikasi (tidak hanya cek duplikat `base_mint`), guna menghindari risiko sistemik pada satu narasi.
- **Market-Adaptive Thresholds**: Mengembangkan `evolveThresholds()` di `src/lib/lessons.ts` agar tidak hanya menyesuaikan `minOrganic`, tetapi juga beradaptasi dengan kondisi market (Bullish/Bearish).

---

## 3. Peningkatan Akurasi Data (Data-Driven)

Meningkatkan kualitas pemilihan pool dengan beralih dari analisis _snapshot_ ke analisis _tren_.

### Rekomendasi Peningkatan:

- **Volume/TVL Momentum**: Menganalisis perubahan volume dan TVL dalam rentang waktu tertentu untuk mendeteksi akumulasi awal sebelum terjadi _pump_.
- **Smart Money Net Flow**: Mengoptimalkan `src/lib/smart-wallets.ts` untuk menghitung _net flow_ (akumulasi vs distribusi) dari wallet alpha, bukan sekadar mendeteksi keberadaan mereka.
- **Real-time Sentiment Analysis**: Mengembangkan `getTokenNarrative` menjadi analisis sentimen real-time dari sumber eksternal (X/Telegram) untuk validasi narasi.

---

## Matriks Prioritas Implementasi

| Prioritas  | Fitur                           | Dampak                     | Area Kode                                         |
| :--------- | :------------------------------ | :------------------------- | :------------------------------------------------ |
| **Tinggi** | Trailing Stop & Tiered TP       | $\uparrow$ Profit Realized | `src/lib/cron.ts`                                 |
| **Tinggi** | Dynamic Position Sizing (Kelly) | $\downarrow$ Drawdown      | `src/lib/config.ts` & `src/lib/tools/executor.ts` |
| **Medium** | Correlation Filter              | $\downarrow$ Systemic Risk | `src/lib/tools/executor.ts`                       |
| **Medium** | Volume Momentum Analysis        | $\uparrow$ Entry Accuracy  | `src/lib/tools/screening.ts`                      |
