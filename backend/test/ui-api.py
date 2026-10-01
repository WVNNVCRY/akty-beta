"""UI-тест API-режима (Playwright): реальный бэкенд + фронтенд из dist-api.
Запуск: сервер на :3000 (npm start в backend, после db:seed), затем  python3 test/ui-api.py"""
import json, os, re, sys, tempfile, urllib.request
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('BASE', 'http://localhost:3000')
OBJ = 'Тверская ул., участок 1'
ok = 0
def check(cond, msg):
    global ok
    if not cond: print('FAIL:', msg); sys.exit(1)
    ok += 1; print('ok ', msg)

pdf = os.path.join(tempfile.gettempdir(), 'scheme.pdf')
open(pdf, 'wb').write(b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')

def api(path, body=None, tok=None):
    r = urllib.request.Request(BASE + '/api/' + path, data=json.dumps(body).encode() if body else None,
                               headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + tok} if tok else {})})
    return json.load(urllib.request.urlopen(r))
gct = api('auth/login', {'login': 'gc', 'password': '123'})['token']
st = api('state', tok=gct)
obj = next(o for o in st['objects'] if o['name'] == OBJ)

def login(page, user, pw='123'):
    page.goto(BASE + '/')
    page.get_by_placeholder('Логин').fill(user)
    page.get_by_placeholder('Пароль').fill(pw)
    page.get_by_role('button', name='Войти').click()

def logout(page):
    page.get_by_role('button', name='Выйти').click()
    expect(page.get_by_placeholder('Логин')).to_be_visible()

def open_obj(page):
    page.goto(f"{BASE}/#/objects/{obj['id']}")
    expect(page.get_by_text(OBJ).first).to_be_visible()

def pick(page, idx, text):
    page.locator('.ant-table .ant-select').nth(idx).click()
    page.locator('.ant-select-dropdown:visible .ant-select-item-option', has_text=text).first.click()

def fill_form(page, code, pm):
    pick(page, 0, code)
    page.locator('.ant-table .ant-input-number-input').first.fill(str(pm))
    inputs = page.locator('input[type=file]')
    inputs.nth(0).set_input_files(pdf)
    expect(page.get_by_text('scheme.pdf').first).to_be_visible()
    inputs.nth(1).set_input_files(pdf)
    expect(page.get_by_text('scheme.pdf').nth(1)).to_be_visible()

def toast(page, text):
    expect(page.locator('.ant-message', has_text=re.compile(text)).last).to_be_visible(timeout=8000)

with sync_playwright() as p:
    b = p.chromium.launch()
    errors = []
    ctx = b.new_context(accept_downloads=True, viewport={'width': 1400, 'height': 900})
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))

    # --- вход
    login(page, 'gc', 'wrong')
    expect(page.get_by_text('Неверный логин или пароль')).to_be_visible()
    check(True, 'неверный пароль → сообщение сервера')
    login(page, 'gc')
    expect(page.get_by_text('Требует внимания').first).to_be_visible()
    check(page.get_by_text('ДЕМО', exact=False).count() == 0 or not page.get_by_text('ДЕМО').first.is_visible(), 'в API-режиме нет демо-панели')
    check(page.evaluate("Object.keys(localStorage).some(k => /token/i.test(k) || /akty/i.test(k))"), 'токен сохранён')
    page.reload()
    expect(page.get_by_text('Требует внимания').first).to_be_visible()
    check(True, 'сессия переживает перезагрузку')
    logout(page)

    # --- подрядчик 1: черновик → подача
    login(page, 'mech'); open_obj(page)
    fill_form(page, '1.1', 2000)
    expect(page.get_by_text('недостача 145', exact=False)).to_be_visible()
    page.get_by_role('button', name='Подать форму').click()
    toast(page, 'принята')
    page.reload(); open_obj(page)
    expect(page.get_by_text('Ожидание партнёра', exact=False).first).to_be_visible()
    check(True, 'механика подала 2000 п.м (=200 м²), статус с сервера после перезагрузки')
    logout(page)

    # --- подрядчик 2: превышение → ошибка сервера не появляется, кнопка блокируется; затем точная подача
    login(page, 'hand'); open_obj(page)
    fill_form(page, '1.14.1', 400)  # 160 м² > 145
    expect(page.get_by_text('Превышение титула', exact=False)).to_be_visible()
    check(True, 'превышение титула подсвечено')
    page.locator('.ant-table .ant-input-number-input').first.fill('362.5')
    expect(page.get_by_text('объём сойдётся с титулом', exact=False)).to_be_visible()
    page.get_by_role('button', name='Подать форму').click()
    toast(page, 'сошлись')
    page.wait_for_timeout(500)
    st = api('state', tok=gct)
    ex = next(e for e in st['executions'] if e['objectId'] == obj['id'])
    act = next((a for a in st['acts'] if a['executionId'] == ex['id']), None)
    check(act is not None and act['status'] == 'ON_CHECK_CLIENT', f"акт создан на сервере: {act and act['number']} {act and act['status']}")
    logout(page)

    # --- заказчик: второй контекст параллельно (проверка синхронизации)
    ctx2 = b.new_context(viewport={'width': 1400, 'height': 900}); p2 = ctx2.new_page()
    login(p2, 'mech'); expect(p2.get_by_role('button', name='Выйти')).to_be_visible()

    login(page, 'client'); open_obj(page)
    btns = page.get_by_role('button', name='Одобрить')
    expect(btns.first).to_be_visible()
    n = btns.count(); check(n == 2, f'заказчик видит {n} формы на одобрение')
    for _ in range(n):
        page.get_by_role('button', name='Одобрить').first.click(); toast(page, 'одобрена')
        page.wait_for_timeout(400)
    st = api('state', tok=gct)
    act = next(a for a in st['acts'] if a['id'] == act['id'])
    check(act['status'] == 'ON_CHECK_GC', 'после одобрения обеих форм акт у ГП')
    logout(page)

    # подрядчик во втором окне получает уведомление без перезагрузки (фокус → refresh)
    p2.evaluate("window.dispatchEvent(new Event('focus'))")
    p2.goto(BASE + '/#/notifications')
    expect(p2.get_by_text('одобр', exact=False).first).to_be_visible(timeout=20000)
    check(True, 'второе окно подрядчика получило уведомление об одобрении')
    ctx2.close()

    # --- ГП: согласование, Word, архив
    login(page, 'gc'); page.goto(f"{BASE}/#/acts/{act['id']}")
    page.get_by_role('button', name='Согласовать акт').first.click()
    page.locator('.ant-modal-confirm .ant-btn-primary', has_text='Согласовать').click()
    toast(page, 'Акт согласован')
    expect(page.get_by_text('Согласован', exact=False).first).to_be_visible()
    with page.expect_download() as d:
        page.get_by_role('button', name='Скачать Word').first.click()
    path = d.value.path(); data = open(path, 'rb').read()
    check(data[:2] == b'PK' and d.value.suggested_filename.endswith('.docx'), f'Word скачан: {d.value.suggested_filename} ({len(data)} б)')
    st = api('state', tok=gct)
    check(next(a for a in st['acts'] if a['id'] == act['id'])['status'] == 'APPROVED', 'акт APPROVED в БД')

    # --- чат
    open_obj(page)
    tab = page.get_by_role('tab', name=re.compile('Чат'))
    if tab.count(): tab.first.click()
    page.get_by_placeholder(re.compile('сообщение', re.I)).first.fill('Проверка чата через API')
    page.keyboard.press('Enter')
    expect(page.get_by_text('Проверка чата через API').first).to_be_visible()
    st = api('state', tok=gct)
    check(any(m['text'] == 'Проверка чата через API' for m in st['chat']), 'сообщение чата сохранено на сервере')

    # --- админка: новый вид разметки
    page.goto(BASE + '/#/admin')
    page.get_by_role('tab', name=re.compile('Виды разметки')).click()
    page.get_by_role('button', name=re.compile('Добавить')).first.click()
    m = page.locator('.ant-modal:visible')
    m.get_by_label(re.compile('Код')).fill('9.99')
    m.get_by_label(re.compile('Наименование|Название')).fill('Тестовая линия')
    nums = m.locator('.ant-input-number-input')
    nums.nth(0).fill('0.15')
    if nums.count() > 1: nums.nth(1).fill('1')
    m.locator('.ant-btn-primary').last.click()
    toast(page, 'Сохранено|сохран|добав')
    st = api('state', tok=gct)
    check(any(x['code'] == '9.99' for x in st['markingTypes']), 'вид разметки создан через админку')

    # --- настройки: смена пароля
    page.goto(BASE + '/#/settings')
    pw = page.locator('input[type=password]')
    pw.nth(0).fill('123'); pw.nth(1).fill('456789'); 
    if pw.count() > 2: pw.nth(2).fill('456789')
    page.get_by_role('button', name='Сменить', exact=True).click()
    toast(page, 'Пароль')
    page.reload(); expect(page.get_by_role('button', name='Выйти')).to_be_visible()
    check(True, 'после смены пароля сессия жива (новый токен)')
    logout(page); login(page, 'gc', '456789'); expect(page.get_by_role('button', name='Выйти')).to_be_visible()
    check(True, 'вход с новым паролем')

    check(not errors, f'нет JS-ошибок на странице {errors[:2]}')
    page.screenshot(path='/home/user/akty-beta/backend/test/ui-api-last.png')
    b.close()
print(f'\nUI API: {ok} проверок пройдено')
