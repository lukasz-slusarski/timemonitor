---
name: biuro
description: Ustawia tytuł, opis i zadanie ClickUp bieżącej sesji w zakładce Biuro (monitor.important.is). Użyj, gdy hook BIURO prosi o tytuł, gdy zmienia się temat pracy, gdy poznasz zadanie ClickUp albo gdy praca jest skończona.
---

# Biuro

Zespół widzi w zakładce Biuro, nad czym pracuje każda sesja Claude. Status i czas wysyła hook pluginu sam. Ty ustawiasz tylko tytuł i opis:

```bash
biuro-doing --session <session_id> 'Krótki tytuł' 'Jedno zdanie, co robisz' [--task <id albo link ClickUp>] [--done]
```

- `session_id` jest w komunikacie BIURO od hooka.
- Tytuł do 80 znaków, po polsku, konkretnie: „Aktualizacja wtyczek WP u Natanka”, nie „Praca nad stroną”.
- Bez haseł, kwot, stawek i danych osobowych. Widzi to cały zespół.
- Zmieniaj tytuł, gdy zmienia się zadanie. `--task` dodaj, gdy znasz zadanie ClickUp; sesje bez zadania trafiają do listy „Do zalogowania w ClickUp”.
- `--done`, gdy praca w tej sesji jest skończona.

Sesje z folderów spoza opcji `roots` pluginu nie są wysyłane.
