package com.example.mytask;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.support.v4.widget.SwipeRefreshLayout;
import android.support.v7.app.AppCompatActivity;
import android.support.v7.widget.DefaultItemAnimator;
import android.support.v7.widget.LinearLayoutManager;
import android.support.v7.widget.RecyclerView;
import android.support.v7.widget.Toolbar;
import android.view.Menu;
import android.view.MenuItem;
import android.widget.ProgressBar;

import java.util.ArrayList;


public class MainActivity extends AppCompatActivity {
    private static RecyclerView mRecyclerView;
    private RecyclerView.LayoutManager mLayoutManager;
    private static SwipeRefreshLayout swipeRefreshLayout;
    private static ProgressBar mProgressBar;
    ArrayList<LoginItem> dataSet=new ArrayList<LoginItem>();
    Dbase dHelper;

    String ftp =null;
    String login=null;
    String password=null;

    final String LOG_TAG = "myLogs";
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        Toolbar toolbar = (Toolbar) findViewById(R.id.toolbar);
        setSupportActionBar(toolbar);
        toolbar.getBackground().setAlpha(200);
        swipeRefreshLayout= (SwipeRefreshLayout) findViewById(R.id.swipe);
        swipeRefreshLayout.setColorSchemeColors(new Color().rgb(28,134,238));
        swipeRefreshLayout.setDistanceToTriggerSync(300);
        dHelper=new Dbase(this);
        mRecyclerView = (RecyclerView) findViewById(R.id.my_recycler_view);
        mRecyclerView.setHasFixedSize(true);
        mLayoutManager = new LinearLayoutManager(this);
        mRecyclerView.setLayoutManager(mLayoutManager);
        mRecyclerView.setItemAnimator(new DefaultItemAnimator());
        mProgressBar=(ProgressBar)findViewById(R.id.progressBar);
        dataSet = dHelper.LoginItems();
        new DownloaderAdd(MainActivity.this,mRecyclerView,mProgressBar,getCacheDir()+"").execute(dataSet.get(0).getNameftp(),dataSet.get(0).getLogin(),dataSet.get(0).getPassword());
        swipeRefreshLayout.setOnRefreshListener(new SwipeRefreshLayout.OnRefreshListener() {
            @Override
            public void onRefresh() {

                new Downloader(MainActivity.this,mRecyclerView,swipeRefreshLayout,getCacheDir()+"").execute(dataSet.get(0).getNameftp(),dataSet.get(0).getLogin(),dataSet.get(0).getPassword());


            }
        });

    }

    @Override

    public boolean onCreateOptionsMenu(Menu menu) {
        // Inflate the menu; this adds items to the action bar if it is present.
        getMenuInflater().inflate(R.menu.menu_main, menu);
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        // Handle action bar item clicks here. The action bar will
        // automatically handle clicks on the Home/Up button, so long
        // as you specify a parent activity in AndroidManifest.xml.
        int id = item.getItemId();

        //noinspection SimplifiableIfStatement
        if (id == R.id.action_add) {
            Intent intent = new Intent(this, Add.class);
            startActivity(intent);
            finish();
        }
        if (id == R.id.action_disconnect) {
            dHelper.DeleteAll();
            Intent intent = new Intent(this, ConnectActivity.class);
            startActivity(intent);
        }


        return super.onOptionsItemSelected(item);
    }

}
