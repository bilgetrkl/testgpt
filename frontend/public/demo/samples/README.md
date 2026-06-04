# TestGPT — Örnek Test Girdileri

Bu klasörde TestGPT arayüzünü denemek için hazır örnek dosyalar bulunur. Hepsi **online alışveriş sepeti** senaryosu üzerinedir.

## Dosyalar

| Dosya | Input type | Format | Açıklama |
|-------|------------|--------|----------|
| `requirements.txt` | Requirements | Metin | Numaralı iş gereksinimleri |
| `use-case.txt` | Use Case | Metin | Aktör, akışlar, istisnalar |
| `user-story.txt` | User Story | Metin | As a / I want / So that + kabul kriterleri |
| `requirements.docx` | Requirements | Word | Aynı içerik, `.docx` yükleme testi |
| `use-case.docx` | Use Case | Word | Aynı içerik, `.docx` yükleme testi |
| `user-story.docx` | User Story | Word | Aynı içerik, `.docx` yükleme testi |
| `requirements.pdf` | Requirements | PDF | Referans; uygulama yalnızca `.txt`, `.md`, `.docx` kabul eder |
| `use-case.pdf` | Use Case | PDF | Referans / dış paylaşım |
| `user-story.pdf` | User Story | PDF | Referans / dış paylaşım |

## Nasıl kullanılır?

1. TestGPT arayüzünü açın (`npm run dev`).
2. **Input type** alanından uygun türü seçin (Requirements / Use Case / User Story).
3. **Upload File** ile ilgili `.txt` veya `.docx` dosyasını yükleyin.
4. **Analyze** ile kalite analizi, davranış ve iş kurallarını inceleyin.
5. **Generate Scenarios** ile Gherkin senaryoları üretin.
6. **Coverage** sekmesinde **Review Coverage** ile semantik kapsam incelemesi yapın.

## PDF dosyaları

PDF doğrudan yüklenemez. İçeriği kopyalayıp textarea'ya yapıştırabilir veya karşılık gelen `.docx` / `.txt` dosyasını kullanabilirsiniz.

## Yeniden üretim

PDF ve DOCX dosyalarını yeniden oluşturmak için:

```bash
/home/oolkay/testgpt/venv/bin/python scripts/generate_sample_files.py
```
