package com.example.mytask;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.os.AsyncTask;
import android.support.v7.widget.RecyclerView;
import android.view.View;
import android.widget.ProgressBar;
import android.widget.Toast;

import org.apache.commons.net.ftp.FTP;
import org.apache.commons.net.ftp.FTPClient;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.FileReader;
import java.io.IOException;
import java.net.SocketException;

/**
 * Created by Константин on 16.03.2017.
 */

public class DownloaderAdd extends AsyncTask<String,Void,String>

{
    Dbase dHelper;
    String name, directory, namefile, dirsave;
    ContentValues cv = new ContentValues();
    Context mContext;
    ProgressBar pb;
    RecyclerView rV;
    String str = null;
    FTPClient mFTP = new FTPClient();

    public DownloaderAdd(Context context, RecyclerView rv, ProgressBar progressBar, String cashe) {
        this.mContext = context;
        this.pb = progressBar;
        this.rV = rv;
        this.dirsave = cashe;
    }

    @Override
    protected void onPreExecute() {
        super.onPreExecute();
        pb.setVisibility(View.VISIBLE);

    }

    @Override
    protected synchronized String doInBackground(String... params) {
        dHelper = new Dbase(mContext);
        SQLiteDatabase db = dHelper.getWritableDatabase();
        Cursor c = db.query("mytable", null, null, null, null, null, null);
        String sr = null;
        try {
            mFTP.connect(params[0]);

            if (!mFTP.login(params[1], params[2])) {
                str = "Ошибка авторизации";
            }


            mFTP.setFileType(FTP.BINARY_FILE_TYPE);
            c.moveToFirst();
            while (c.isAfterLast() == false) {
                sr = downloadData(c.getString(c.getColumnIndex("directory")), c.getString(c.getColumnIndex("namefile")));
                cv.put("timesum", sr);
                db.update("mytable", cv, "name=?", new String[]{c.getString(c.getColumnIndex("name"))});
                System.out.println(sr);

                c.moveToNext();
            }
            db.close();

            mFTP.enterLocalPassiveMode();
            mFTP.logout();
            mFTP.disconnect();

        } catch (SocketException e) {
            e.printStackTrace();
        } catch (IOException e) {
            // TODO Auto-generated catch block
            str = "Ошибка соединения с сервером";
            e.printStackTrace();
        }
        return str;
    }

    @Override
    protected void onPostExecute(String str) {
        dHelper = new Dbase(mContext);
        pb.setVisibility(View.GONE);

        if (str == null) {
            rV.setAdapter(new RecyclerAdapter(mContext, dHelper.getAllItems()));
        } else {
            Toast.makeText(mContext, str, Toast.LENGTH_SHORT).show();
            rV.setAdapter(new RecyclerAdapter(mContext, dHelper.getAllItems()));
        }

    }

    private String downloadData(String directory, String namefile) {
        String directory1 = directory;
        String namefile1 = namefile;
        String st = "";


        try {
            boolean successDir=mFTP.changeWorkingDirectory(directory1);
            if(successDir) {
                System.out.println(mFTP.changeWorkingDirectory(directory1));
                FileOutputStream outputStream = new FileOutputStream(dirsave + "/" + "data.txt");
                boolean succcessFile=mFTP.retrieveFile(namefile1, outputStream);
                if (succcessFile) {
                    File sdPath = new File(dirsave + "/");
                    File sdFile = new File(sdPath, "data.txt");
                    try {
                        // открываем поток для чтения
                        BufferedReader br = new BufferedReader(new FileReader(sdFile));
                        // читаем содержимое
                        st = br.readLine();
                    } catch (FileNotFoundException e) {
                        e.printStackTrace();
                        st = "Файл не удалось прочитать";
                    } catch (IOException e) {
                        st = "Файл не удалось прочитать";
                        e.printStackTrace();
                    }
                }
                else{
                    st="Файл не найден";
                }
                outputStream.close();
            }
            else {
                st="Файл не найден";
            }
        } catch (SocketException e) {
            // TODO Auto-generated catch block
            e.printStackTrace();
            st="Файл не найден";
        } catch (IOException e) {
            // TODO Auto-generated catch block
            st="Файл не найден";
            e.printStackTrace();
        }
        return st;

    }
}
