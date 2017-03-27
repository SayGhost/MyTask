package com.example.mytask;

import android.content.Intent;
import android.os.Bundle;
import android.support.v7.app.AppCompatActivity;

/**
 * Created by Константин on 20.03.2017.
 */

public class SplashActivity extends AppCompatActivity{
    Dbase dHelper;
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        dHelper = new Dbase(this);
        if (dHelper.EmptyLogin()) {
            Intent intent = new Intent(this, ConnectActivity.class);
            startActivity(intent);
            finish();
        }
        else{
            Intent intent = new Intent(this, MainActivity.class);
            startActivity(intent);
            finish();
        }
    }
}
