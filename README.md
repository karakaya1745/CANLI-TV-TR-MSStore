# CANLI TV TR (Windows / Microsoft Store)

Windows masaüstü ve Microsoft Store sürümü. Android uygulamasındaki kanal listesi ve M3U8 akış haritasını kullanır.

**Paket kimliği (hedef):** `com.canlitvtr.app`  
**Kaynak Android projesi:** `D:\PROJELER\ANDROİD TV UYGULAMASI2`

## Teknoloji

| Katman | Seçim |
|--------|--------|
| Çatı | **Electron 35** |
| Oynatıcı | **hls.js** (M3U8/HLS) |
| Mağaza paketi | **MSIX (AppX)** via `electron-builder` |
| Veri | `data/channels.json`, `data/stream_map.json` (Android assets’ten kopyalandı) |

WinUI 3 / .NET MAUI bu makinede scaffold edilemedi (`.NET SDK` yüklü değil). Electron, Node.js ile hemen çalışır ve Microsoft Store’a MSIX olarak paketlenebilir.

## Gereksinimler

- Windows 10/11 (x64)
- [Node.js](https://nodejs.org/) 20+ (LTS önerilir)
- Microsoft Store yayını için: [Partner Center](https://partner.microsoft.com/) hesabı (kayıt ücretsiz)

## Kurulum

```powershell
cd "D:\PROJELER\CANLI-TV-TR-MSStore"
npm install
```

SSL sertifika hatası (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`) alırsanız:

```powershell
$env:NODE_OPTIONS="--use-system-ca"
npm install
```

## Geliştirme (yerel çalıştırma)

```powershell
npm start
```

Uygulama yatay/deskop düzeninde açılır: solda arama ve kanal listesi, sağda HLS oynatıcı.

## Derleme

### Taşınabilir klasör (hızlı test)

```powershell
npm run pack
```

Çıktı: `dist\win-unpacked\`

### Windows yükleyici + MSIX

```powershell
npm run dist
```

Çıktılar:

- `dist\CANLI TV TR Setup *.exe` (NSIS)
- `dist\CANLI TV TR *.appx` (Microsoft Store / sideload MSIX)

Yalnızca MSIX:

```powershell
npm run dist:msix
```

## Microsoft Store yayın adımları

1. **Partner Center**’da yeni uygulama oluşturun.
2. **Identity** bilgilerini `package.json` → `build.appx` altına yazın:
   - `identityName`
   - `publisher` (ör. `CN=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`)
   - `publisherDisplayName`
3. Uygulama simgesi ekleyin (`build/icon.ico`, en az 256×256).
4. `npm run dist:msix` ile `.appx` üretin.
5. Partner Center → **Packages** bölümüne MSIX yükleyin veya WinUI/Store pipeline ile imzalayın.
6. Mağaza listesi: ekran görüntüleri (1366×768, 1920×1080), kısa/uzun açıklama, gizlilik politikası URL’si.

> **Not:** Partner Center Product Identity değerleri (`identityName`, `publisher`, `publisherDisplayName`) `build.appx` içine eklendi; MSIX üretimi bu kimlikle yapılır.

## Gizlilik politikası (GitHub Pages)

Mağaza için gerekli gizlilik metni `docs/privacy.html` içindedir. Yayınlamadan önce dosyadaki `DESTEK_EPOSTA` yer tutucusunu gerçek destek adresinizle değiştirin (ör. `privacy@canlitvtr.com`).

1. GitHub’da **public** repo oluşturun veya mevcut repoyu kullanın.
2. `docs/` klasörünü repoya push edin (`git add docs`, `git commit`, `git push`).
3. Repo → **Settings** → **Pages** → **Build and deployment** → Source: **Deploy from a branch**.
4. Branch: `main` veya `master`, klasör: **`/docs`** → **Save**.
5. Birkaç dakika sonra sayfa yayında olur: `https://KULLANICI.github.io/REPO-ADI/privacy.html`
6. Partner Center → uygulama → **Özellikler** → **Gizlilik politikası URL’si** alanına bu adresi yapıştırın.

## MVP’de çalışan özellikler

- `channels.json` ve `stream_map.json` yükleme
- Popülerlik sırası (Android ile aynı `CHANNEL_POPULARITY_ORDER`)
- Kategori sekmeleri ve metin araması
- Kanal logosu (Google favicon API, Android ile aynı yaklaşım)
- Kanal seçince M3U8 oynatma; birden fazla yedek URL varsa otomatik failover
- Landscape-friendly iki sütunlu arayüz
- **D-pad / klavye navigasyonu:** ok tuşlarıyla kanal listesinde gezinme, Enter ile oynatma, `F` ile tam ekran, tam ekranda ok tuşlarıyla kanal değiştirme (zapping), `Esc` ile çıkış/listeye dönüş

## Henüz yapılmayan (sonraki adımlar)

### EPG (program rehberi)

- EPG özelliği uygulamadan kaldırıldı: kullanılan XMLTV feed’i (`tr.xml`) ölü olduğu için işlevsizdi.
- İleride güvenilir bir EPG kaynağı bulunursa yeniden değerlendirilebilir.

### Reklamlar

- AdMob Windows’ta yok
- Seçenekler: Microsoft Ads SDK, üçüncü parti banner (webview), veya Store sürümünde reklamsız premium odaklı model

### Microsoft Store IAP (reklamsız premium)

- `windows-store` / `electron-windows-store` veya native `StoreContext` köprüsü
- Premium durumunu `electron-store` veya Windows Credential Locker ile saklama
- Partner Center’da tek seferlik “Remove Ads” ürünü tanımlama

### TV / uzaktan kumanda (D-pad) — temel destek eklendi

- `ArrowUp` / `ArrowDown` ile kanal listesi odak gezinmesi ✓
- `Enter` ile oynat, `Escape` ile listeye dön ✓
- `F` ile tam ekran, tam ekranda ok tuşlarıyla kanal değiştirme ✓
- Sonraki adım: 10-foot UI ölçeklendirme ve sol/sağ D-pad ile sekme/panel geçişi

### Mağaza varlıkları

- `build/icon.ico`, Store tile görselleri, trailer/video, TR/EN açıklamalar
- Gizlilik politikası ve içerik derecelendirme anketi

### Web yedek oynatıcı

- Android’de M3U8 yoksa kanal web sitesi WebView ile açılıyor
- Windows MVP yalnızca M3U8; web fallback için ikinci aşamada `BrowserView` veya harici tarayıcı

## Kanal verisini güncelleme

Android projesinden yeniden kopyalayın:

```powershell
Copy-Item "D:\PROJELER\ANDROİD TV UYGULAMASI2\app\src\main\assets\channels.json" "D:\PROJELER\CANLI-TV-TR-MSStore\data\channels.json"
Copy-Item "D:\PROJELER\ANDROİD TV UYGULAMASI2\app\src\main\assets\stream_map.json" "D:\PROJELER\CANLI-TV-TR-MSStore\data\stream_map.json"
```

## Proje yapısı

```
CANLI-TV-TR-MSStore/
  data/                 # channels.json, stream_map.json
  docs/                 # privacy.html (GitHub Pages / Store)
  src/
    main/               # Electron main process
    renderer/           # UI + HLS player
  package.json
  README.md
```

## GitHub Pages (Gizlilik Politikası)

Microsoft Store Partner Center’da istenen gizlilik politikası URL’si için `docs/privacy.html` dosyası hazırdır.

1. GitHub’da **public** bir depo oluşturun (ör. `CANLI-TV-TR-MSStore`).
2. Bu projeyi depoya gönderin (`git remote add`, `git push`).
3. Depo **Settings → Pages** bölümünde kaynak olarak **main** dalı ve klasör olarak **/docs** seçin.
4. Birkaç dakika sonra sayfa yayında olur: `https://KULLANICI_ADINIZ.github.io/REPO_ADI/privacy.html`
5. Yayınlamadan önce `docs/privacy.html` ve bu README’deki `DESTEK_EPOSTA` yer tutucusunu gerçek destek e-postanızla değiştirin.
6. Oluşan URL’yi Partner Center → uygulama özellikleri → **Gizlilik politikası** alanına yapıştırın.

## Bilinen kısıtlar

- İlk çalıştırmada `.NET SDK` olmadığı için WinUI/MAUI seçilmedi
- `npm install` bu ortamda `$env:NODE_OPTIONS="--use-system-ca"` gerektirebilir (kurumsal SSL)
- Store MSIX kimliği Partner Center değerleriyle uild.appx içinde tanımlı
- MSIX üretimi Developer Mode veya yönetici symlink izni isteyebilir (`electron-builder` winCodeSign önbelleği)
- Uygulama simgesi henüz yok (`build/icon.ico` eklendiğinde paket görünümü düzelir)
- Bazı akışlar coğrafi veya ağ kısıtına tabi olabilir; failover yine de Android mantığıyla çalışır
- Web kanal fallback henüz yok
