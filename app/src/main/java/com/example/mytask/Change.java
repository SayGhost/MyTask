package com.example.mytask;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;

/**
 * Created by Константин on 26.03.2017.
 */

public class Change extends Activity {
    final String LOG_TAG = "myLogs";
    Dbase dbHelper;
    private EditText  inputDir, inputFile;
    private Button btnChange;
    String MName;
    /**
     * Called when the activity is first created.
     */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.change);
        inputDir = (EditText) findViewById(R.id.input_dir);
        inputFile = (EditText) findViewById(R.id.input_file);
        inputDir.setTextColor(Color.WHITE);
        inputFile.setTextColor(Color.WHITE);
        btnChange = (Button) findViewById(R.id.btn_change);
        Intent intent = getIntent();
        MName = intent.getStringExtra("MName");
        // создаем объект для создания и управления версиями БД
        dbHelper = new Dbase(this);
        btnChange.setOnClickListener(new View.OnClickListener() {
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
        btnChange.setEnabled(false);

        String directory = inputDir.getText().toString();
        String namefile = inputFile.getText().toString();
        System.out.println(MName);
        dbHelper.UpdateItem(MName,directory,namefile);
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


        String dir = inputDir.getText().toString();
        String file = inputFile.getText().toString();


        if (dir.isEmpty()) {
            inputDir.setError("wrong directory");
            valid = false;
        } else {
            inputDir.setError(null);
        }
        if (file.isEmpty()) {
            inputFile.setError("wrong file");
            valid = false;
        } else {
            inputFile.setError(null);
        }
        return valid;
    }
}
