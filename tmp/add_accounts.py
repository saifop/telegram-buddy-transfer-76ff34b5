from pyrogram import Client,filters
import redis
import numpy as np
import re
from pyrogram.types import (InlineKeyboardMarkup,InlineKeyboardButton)
Devs = [633004612,1111233768]
pool = redis.ConnectionPool(host='localhost', port=6379, db=5)
r = redis.Redis(connection_pool=pool, encoding="utf-8", decode_responses=True)
def r_e(string):
    fr = str(string).replace("b'", "").replace("'", "").replace("{", "").replace("}", "").replace(",", "").split()
    return fr

def ex_username(th):
    if th.count('@'):
        return th.split("@")[1]
    if th.count("+"):
        return th
    if re.match("https://t\.me/(.*?)$",th):
        return re.match("https://t\.me/(.*?)$",th).group(1)
    else:
        return th
def clear_redis():
    r.delete("steps:procsses_run")
    r.delete("cache:username_main_group_username")
    r.delete("cache:username_group_stel")
    r.delete("steps:add_stel_group_username")
    r.delete("cache:username_group_stel")
    r.delete("cache:username_main_group_username")
    r.delete("steps:add_main_group_username")
    r.delete("steps:add_new_account")
    return True
@Client.on_message(filters.command("start"),group=1)
async def do_add(client,message):
    if message.from_user.id in Devs:
        Keys = InlineKeyboardMarkup([[InlineKeyboardButton("اضافة حساب", callback_data=f'admin:add_account')],[InlineKeyboardButton("حذف حساب", callback_data=f'admin:delete_account')],[InlineKeyboardButton("بدأ عملية الان", callback_data=f'admin:stell_from_group')],[InlineKeyboardButton("إضافة ادمن جديد", callback_data=f'admin:add_new_admin')],[InlineKeyboardButton("إزالة ادمن", callback_data=f'admin:reomve_admin')]])
        await client.send_message(message.chat.id,f"- Hi Daddy (; .",reply_markup=Keys)
    if str(message.from_user.id) in r_e(r.smembers("admin:admins:ids_list")):
        Keys = InlineKeyboardMarkup([[InlineKeyboardButton("اضافة حساب", callback_data=f'admin:add_account')],[InlineKeyboardButton("حذف حساب", callback_data=f'admin:delete_account')],[InlineKeyboardButton("بدأ عملية الان", callback_data=f'admin:stell_from_group')]])
        await client.send_message(message.chat.id,f"- Hi Admin (; .",reply_markup=Keys)
    if str(message.from_user.id) not in r_e(r.smembers("admin:admins:ids_list")):
        if  message.from_user.id not in Devs:
            await client.send_message(message.chat.id,f"- This Bot Is Not For Your Mom ! .")
@Client.on_callback_query(group=2)
async def do_call(client,CallbackQuery):
    message = CallbackQuery.message
    data = CallbackQuery.data
    if data == "admin:add_account":
        await client.send_message(message.chat.id,f"- قم بأرسال كود الجلسه بايروقرام .")
        r.set("steps:add_new_account","true")
    if data == "admin:stell_from_group":
        await client.send_message(message.chat.id, "- قم بأرسال معرف المجموعه المراد النقل منها بدون علامة @ .")
        r.set("steps:add_stel_group_username", "true")
    if data == "admin:add_new_admin":
        await client.send_message(message.chat.id,f"- قم بأرسال ايدي الادمن الجديد .")
        r.set("steps:add_new_admin","true")
    if data == "admin:reomve_admin":
        await client.send_message(message.chat.id,f"- قم بأرسال ايدي الادمن .")
        r.set("steps:remove_new_admin","true")

@Client.on_message(filters.text,group=3)
async def sad(client,message):
    lo = []
    if r.get("steps:add_new_admin"):
        r.sadd("admin:admins:ids_list",f"{message.text}")
        await client.send_message(message.chat.id,f"- تمت اضافة الادمن ({message.text}) بنجاح .")
        r.delete("steps:add_new_admin")
    if r.get("steps:remove_new_admin"):
        r.srem("admin:admins:ids_list",f"{message.text}")
        await client.send_message(message.chat.id,f"- تمت اوالة الادمن ({message.text}) بنجاح .")
        r.delete("steps:remove_new_admin")
    if message.text == "clear":
        clear_redis()
        await client.send_message(message.chat.id,"done")
    if r.get("steps:add_stel_group_username") and message.text not in lo:
        user = ex_username(message.text)
        r.set("cache:username_group_stel",f"{user}")
        await client.send_message(message.chat.id, f"- تمت الاضافة الان قم بأرسال معرف المجموعه الخاصه بك .")
        lo.append(message.text)
        r.delete("steps:add_stel_group_username")
        r.set("steps:add_main_group_username","true")
    if r.get("steps:add_main_group_username") and message.text != r.get("cache:username_group_stel").decode('utf-8')and message.text not in lo:
        main_user = ex_username(message.text)
        r.set("cache:username_main_group_username",f"{main_user}")
        await client.send_message(message.chat.id, "- جاري بدأ العملية الآن ! ...")
        lo.append(message.text)
        r.delete("steps:add_main_group_username")
        r.set("steps:procsses_run", "true")
    if r.get("steps:procsses_run"):
        seesions = r_e(r.smembers("AccountsControl"))
        main_group = r.get("cache:username_main_group_username").decode('utf-8')
        stell_group_username = r.get("cache:username_group_stel").decode('utf-8')
        errors = 0
        done = 0
        account_number = 0
        count = await client.get_chat_members_count(str(ex_username(stell_group_username)))
        for guest in seesions:
            account_number += 1
            try:
                async with Client(f"{guest}", api_id=19757887,
                                  api_hash="1842795779:AAG-EucJEo_-P_xcBtk82RUIJi6bk52kOps") as guest:
                    j = await guest.get_chat_members(str(stell_group_username), limit=int(count))
                    members = np.random.choice(j, 60, replace=False)
                    for userl in members:
                        try:
                            print(ex_username(main_group))
                            await guest.add_chat_members(str(ex_username(main_group)), userl.user.id)
                            done += 1
                        except Exception as l:
                            print(l)
                            errors += 1
                            pass
                await guest.stop()
            except Exception as errorguest:
                print(errorguest)
                pass
        if errors == 60:
            await client.send_message(message.chat.id, f"- تمت استخدام ({account_number}) حساب .\n"
                                                       f"- نجح في اضافة : ({done}) .\n- فشل في اضافة ({errors}) ."
                                                       f"\nالحساب انحظر من الاضافه !")
        else:
            await client.send_message(message.chat.id, f"- تمت استخدام ({account_number}) حساب .\n"
                                                       f"- نجح في اضافة : ({done}) .\n- فشل في اضافة ({errors}) ."
                                                       f"ا")
    if r.get("steps:add_new_account") and message.text != "- قم بأرسال كود الجلسه بايروقرام .":
        try:
            async with Client(f"{message.text}", api_id=19757887
                    , api_hash="e76390019d6fa291b1ca0f8b3d71d005") as gst:
                await gst.send_message("me", "Test !")
                r.sadd('AccountsControl', f"{message.text}")
                await client.send_message(message.chat.id, "- تمت اضافة الحساب")
                await gst.stop()
        except:
            await client.send_message(message.chat.id, "- كود خاطء")
            pass

