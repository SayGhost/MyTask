package com.example.mytask;

/**
 * Created by Константин on 21.03.2017.
 */

import android.app.Activity;
import android.app.ProgressDialog;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.util.Log;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.Toast;

import org.apache.commons.net.ftp.FTPClient;

import java.io.IOException;
import java.net.SocketException;

public class ConnectActivity extends Activity {
    private static final String TAG = "LoginActivity";
    private EditText inputName, inputLogin, inputPassword;
    private Button btnConnect;
    Handler h;
    Dbase dbHelper;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.connect_ftp);
        inputName = (EditText) findViewById(R.id.input_name);
        inputLogin = (EditText) findViewById(R.id.input_login);
        inputPassword = (EditText) findViewById(R.id.input_password);
        inputName.setTextColor(Color.WHITE);
        inputPassword.setTextColor(Color.WHITE);
        inputLogin.setTextColor(Color.WHITE);
        btnConnect= (Button) findViewById(R.id.btn_connect);
        dbHelper = new Dbase(this);
        btnConnect.setOnClickListener(new View.OnClickListener() {

            @Override
            public void onClick(View v) {
                connect();
            }
        });
    }

    public void connect() {
        Log.d(TAG, "Connect");

        if (!validate()) {
            onLoginFailed();
            return;
        }

        btnConnect.setEnabled(false);

        final ProgressDialog progressDialog = new ProgressDialog(ConnectActivity.this,R.style.AppTheme_NoActionBar);
        progressDialog.setIndeterminate(true);
        progressDialog.setMessage("Connect...");
        progressDialog.show();

        // TODO: Implement your own authentication logic here.
        h=new Handler() {
            public void handleMessage(android.os.Message msg) {
                if(msg.what==1){
                    onLoginSuccess();
                    progressDialog.dismiss();
                }
                if (msg.what==2)
                {
                    onLoginFailed();
                    progressDialog.dismiss();
                    return;
                }

            }
        };


        Thread t = new Thread(new Runnable() {
            public void run() {
                FTPClient mFTP = new FTPClient();
                boolean b=true;
                try {
                    Thread.sleep(3000);
                    mFTP.connect(inputName.getText().toString());
                    if (!mFTP.login(inputLogin.getText().toString(),inputPassword.getText().toString()))
                    {
                        b=false;
                    }


                } catch (SocketException e) {
                    e.printStackTrace();
                    b=false;
                } catch (IOException e) {
                    e.printStackTrace();
                    b=false;
                }
                catch (Exception e) {

                }

                   if (b==true)
                       h.sendEmptyMessage(1);
                else h.sendEmptyMessage(2);

                }
            });
        t.start();
    }



    @Override
    public void onBackPressed() {
        // disable going back to the MainActivity
        moveTaskToBack(true);
    }

    public void onLoginSuccess() {

        dbHelper.LoginItem(inputName.getText().toString(),inputLogin.getText().toString(),inputPassword.getText().toString());
        btnConnect.setEnabled(true);
        Intent intent = new Intent(this, MainActivity.class);
        startActivity(intent);
        finish();
    }

    public void onLoginFailed() {
        Toast.makeText(getBaseContext(), "Connect failed", Toast.LENGTH_LONG).show();
        inputName.setError("wrong name");
        inputPassword.setError("wrong password");
        inputLogin.setError("wrong login");
        btnConnect.setEnabled(true);
    }

    public boolean validate() {
        boolean valid = true;


        String name = inputName.getText().toString();
        String login = inputLogin.getText().toString();
        String password = inputPassword.getText().toString();

        if (name.isEmpty()) {
            inputName.setError("wrong name");
            valid = false;
        } else {
            inputName.setError(null);
        }

        if (password.isEmpty()) {
            inputPassword.setError("wrong password");
            valid = false;
        } else {
            inputPassword.setError(null);
        }
        if (login.isEmpty()) {
            inputLogin.setError("wrong login");
            valid = false;
        } else {
            inputLogin.setError(null);
        }
        return valid;
    }
}
