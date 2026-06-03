
# Pytechka

Pytechka е web/app приложение, целящо да насърчава хората да прекарват повече време сред природата, но също така и да я опазва.

Потребителите могат да следват вече съществуващи пътеки или да създадат собствени. Това позволява на всеки да допринася за развитието.

Всеки потребител може да сигнализира за наличието на прекомерно количетво боклук. При обратна връзка от повече потребители се задейства кампания за почистване.


Всеки потребител получава медал за участие в различни сфери

|     | Trailer | Contribution   |Campaign            |
|-----| ------- | ---------------|--------------------|
| +3  | Rookie  | New guide      | Volunteer          |
| +10 | Junior  | Local guide    | Helper             |
| +20 | Senior  | Country guide  | Basically organizer| 


## Инсталация

1. Клонирайте проекта и влезте в папката му.
```bash
    git clone github.com/KameZh/Pytechka
```
2. Активирайте virtual environment
##### * за Windows
```bash
    python -m venv .venv
    .venv\Scripts\activate 
```
##### * за Mac/Linux
```bash
    python -m venv .venv
    source .venv/bin/activate
```
3. Инсталирайте зависимостите и в двете поддиректории:
```bash
    pip install -r requirements.txt
    cd ./src/frontend && npm install --legacy-peer-deps
```
4. Попълнете `.env` файловете по техните шаблони и ги оставете в същата директория като шаблона.
5. Стартирайте приложението:
```bash
    cd ./src/frontend && npm run build && npm run dev
    cd ../backend && python manage.py runserver 8000
```

6. Използване на приложението: 
```
    localhost:5173
```