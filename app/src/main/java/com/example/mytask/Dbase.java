package com.example.mytask;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.util.Log;

import java.util.ArrayList;

/**
 * Created by Константин on 27.02.2017.
 */

public class Dbase extends SQLiteOpenHelper {
        final String LOG_TAG = "myLogs";
        private static Dbase db;
        Context context;
        public Dbase(Context context) {
                // конструктор суперкласса
                super(context, "myDB", null, 1);
                this.context = context;
        }


        @Override
        public void onCreate(SQLiteDatabase db) {
                Log.d(LOG_TAG, "--- onCreate database ---");
                // создаем таблицу с полями
                db.execSQL("create table mytable ("
                        + "id integer primary key autoincrement,"
                        + "name text,"
                        + "directory text,"
                        + "namefile text," + "timesum text" + ");");
                db.execSQL("create table login ("
                        + "id integer primary key autoincrement,"
                        + "nameftp text,"
                        + "login text,"
                        + "password text" + ");");
        }

        @Override
        public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {

        }

        public ArrayList<ObjectItem> getAllItems() {
                ArrayList<ObjectItem> toRet = new ArrayList<ObjectItem>();
                SQLiteDatabase db = getReadableDatabase();
                Cursor c = db.query("mytable", null, null, null, null, null, null);
                c.moveToFirst();

                while (c.isAfterLast() == false) {
                        toRet.add(new ObjectItem(c.getString(c.getColumnIndex("name")),c.getString(c.getColumnIndex("timesum"))));
                        c.moveToNext();

                }
                db.close();

                return toRet;
        }
        public void deleteItem(String rowId) {
                SQLiteDatabase db = getWritableDatabase();
                db.delete("mytable","name=?",new String[]{rowId});
                db.close();
        }
        public boolean PrimaryName(String name){
                boolean b = true;
                SQLiteDatabase db = getWritableDatabase();
                Cursor ct = db.query("mytable", null, null, null, null, null, null);
                ct.moveToFirst();
                while (ct.isAfterLast() == false) {
                       if (ct.getString(ct.getColumnIndex("name")).equals(name)==true)
                       {b=false;}
                        ct.moveToNext();
                }
                db.close();
                return b;
        }
        public Long ADDItem(String namemag,String directory,String namefile) {
                SQLiteDatabase db = getWritableDatabase();
                ContentValues cv = new ContentValues();
                cv.put("name", namemag);
                cv.put("directory", directory);
                cv.put("namefile", namefile);
                cv.put("timesum", "null");
                return  db.insert("mytable", null, cv);
        }
        public ArrayList<LoginItem> LoginItems() {
                ArrayList<LoginItem> toRet = new ArrayList<LoginItem>();
                SQLiteDatabase db = getReadableDatabase();
                Cursor c = db.query("login", null, null, null, null, null, null);
                c.moveToFirst();

                while (c.isAfterLast() == false) {
                        toRet.add(new LoginItem(c.getString(c.getColumnIndex("nameftp")),c.getString(c.getColumnIndex("login")),c.getString(c.getColumnIndex("password"))));
                        c.moveToNext();

                }
                db.close();

                return toRet;
        }
        public Long LoginItem(String nameftp,String login,String password) {
                SQLiteDatabase db = getWritableDatabase();
                ContentValues cv = new ContentValues();
                cv.put("nameftp", nameftp);
                cv.put("login", login);
                cv.put("password", password);
                return  db.insert("login", null, cv);
        }
        public boolean EmptyLogin()
        {
                boolean b = false;
                SQLiteDatabase db = getWritableDatabase();
                Cursor ct = db.query("login", null, null, null, null, null, null);
                if (ct.getCount()==0)
                        b=true;
                db.close();
                return b;
        }
        public void DeleteAll()
        {
                SQLiteDatabase db = getWritableDatabase();
                db.delete("login",null,null);
        }
        public void UpdateItem(String name,String dir,String namefile)
        {
                SQLiteDatabase db = getWritableDatabase();
                ContentValues cv = new ContentValues();
                cv.put("directory", dir);
                cv.put("namefile", namefile);
                db.update("mytable",cv,"name=?",new String[]{name});
                db.close();
        }
}