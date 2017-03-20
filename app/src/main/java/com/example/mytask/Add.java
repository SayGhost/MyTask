package com.example.mytask;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.os.Bundle;
import android.support.design.widget.TextInputLayout;
import android.text.Editable;
import android.text.TextWatcher;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
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
        inputLayoutName = (TextInputLayout) findViewById(R.id.input_layout_name);
        inputLayoutDir = (TextInputLayout) findViewById(R.id.input_layout_dir);
        inputLayoutFile = (TextInputLayout) findViewById(R.id.input_layout_file);
        inputName = (EditText) findViewById(R.id.input_name);
        inputDir = (EditText) findViewById(R.id.input_dir);
        inputFile = (EditText) findViewById(R.id.input_file);
        btnAdd = (Button) findViewById(R.id.btn_add);

        inputName.addTextChangedListener(new MyTextWatcher(inputName));
        inputDir.addTextChangedListener(new MyTextWatcher(inputDir));
        inputFile.addTextChangedListener(new MyTextWatcher(inputFile));
        // создаем объект для создания и управления версиями БД
        dbHelper = new Dbase(this);
        btnAdd.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                submitForm();
            }
        });
    }


    @Override
    public void finish() {
        Intent returnIntent = new Intent();
        setResult(RESULT_OK, returnIntent);
        super.finish();
    }

    private void submitForm() {
        if (!validateName()) {
            return;
        }
        if (!dbHelper.PrimaryName(inputName.getText().toString()))
        {   inputLayoutName.setError(getString(R.string.err_msg_name_un));
            requestFocus(inputName);
            return;
        }

        if (!validateDir()) {
            return;
        }

        if (!validateFile()) {
            return;
        }
        ContentValues cv = new ContentValues();
        // получаем данные из полей ввода
        String name = inputName.getText().toString();
        String directory = inputDir.getText().toString();
        String namefile = inputFile.getText().toString();
        // подключаемся к БД
                Log.d(LOG_TAG, "--- Insert in mytable: ---");
                // подготовим данные для вставки в виде пар: наименование столбца - значение

                cv.put("name", name);
                cv.put("directory", directory);
                cv.put("namefile", namefile);
                cv.put("timesum", "null");
                Log.d(LOG_TAG, "row inserted, ID = " + dbHelper.ADDItem(name, directory, namefile));
                dbHelper.close();
                finish();

    }

    private boolean validateName() {
        if (inputName.getText().toString().trim().isEmpty()) {
            inputLayoutName.setError(getString(R.string.err_msg_name));
            requestFocus(inputName);
            return false;
        }
        else inputLayoutName.setErrorEnabled(false);
        return true;
    }

    private boolean validateDir() {
        String email = inputDir.getText().toString().trim();

        if (email.isEmpty()) {
            inputLayoutDir.setError(getString(R.string.err_msg_dir));
            requestFocus(inputDir);
            return false;
        } else {
            inputLayoutDir.setErrorEnabled(false);
        }

        return true;
    }

    private boolean validateFile() {
        if (inputFile.getText().toString().trim().isEmpty()) {
            inputLayoutFile.setError(getString(R.string.err_msg_file));
            requestFocus(inputFile);
            return false;
        } else {
            inputLayoutFile.setErrorEnabled(false);
        }

        return true;
    }
    private void requestFocus(View view) {
        if (view.requestFocus()) {
            getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);
        }
    }

    private class MyTextWatcher implements TextWatcher {

        private View view;

        private MyTextWatcher(View view) {
            this.view = view;
        }

        public void beforeTextChanged(CharSequence charSequence, int i, int i1, int i2) {
        }

        public void onTextChanged(CharSequence charSequence, int i, int i1, int i2) {
        }

        public void afterTextChanged(Editable editable) {
            switch (view.getId()) {
                case R.id.input_name:
                    validateName();
                    break;
                case R.id.input_dir:
                    validateDir();
                    break;
                case R.id.input_file:
                    validateFile();
                    break;
            }
        }
    }
}