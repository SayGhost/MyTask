package com.example.mytask;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.support.design.widget.TextInputLayout;
import android.util.Log;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;


/**
        * Created by Константин on 25.02.2017.
        */

public class Add extends Activity {
    final String LOG_TAG = "myLogs";
    Dbase dbHelper;
    private EditText inputName, inputDir, inputFile;
    private TextInputLayout inputLayoutName, inputLayoutDir, inputLayoutFile;
    private Button btnAdd;

    /**
     * Called when the activity is first created.
     */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.add);

        inputName = (EditText) findViewById(R.id.input_name);
        inputDir = (EditText) findViewById(R.id.input_dir);
        inputFile = (EditText) findViewById(R.id.input_file);
        inputName.setTextColor(Color.WHITE);
        inputDir.setTextColor(Color.WHITE);
        inputFile.setTextColor(Color.WHITE);
        btnAdd = (Button) findViewById(R.id.btn_add);
        // создаем объект для создания и управления версиями БД
        dbHelper = new Dbase(this);
        btnAdd.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                submitForm();
            }
        });
    }





    private void submitForm() {
        if (!validate()) {
            return;
        }
        if (!dbHelper.PrimaryName(inputName.getText().toString()))
        {
            inputName.setError("This shop is exist");
            return;
        }
        else {
            inputName.setError(null);
        }
        btnAdd.setEnabled(false);
        // получаем данные из полей ввода
        String name = inputName.getText().toString();
        String directory = inputDir.getText().toString();
        String namefile = inputFile.getText().toString();

                Log.d(LOG_TAG, "--- Insert in mytable: ---");
                Log.d(LOG_TAG, "row inserted, ID = " + dbHelper.ADDItem(name, directory, namefile));
                dbHelper.close();
                Intent intent = new Intent(this, MainActivity.class);
                startActivity(intent);
                finish();

    }
    public void onBackPressed() {
        Intent intent = new Intent(this, MainActivity.class);
        startActivity(intent);
        finish();
    }
    public boolean validate() {
        boolean valid = true;


        String name = inputName.getText().toString();
        String login = inputDir.getText().toString();
        String password = inputFile.getText().toString();

        if (name.isEmpty()) {
            inputName.setError("wrong name");
            valid = false;
        } else {
            inputName.setError(null);
        }

        if (password.isEmpty()) {
            inputDir.setError("wrong directory");
            valid = false;
        } else {
            inputDir.setError(null);
        }
        if (login.isEmpty()) {
            inputFile.setError("wrong file");
            valid = false;
        } else {
            inputFile.setError(null);
        }
        return valid;
    }


}