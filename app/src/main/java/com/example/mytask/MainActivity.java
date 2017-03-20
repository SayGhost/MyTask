package com.example.mytask;

import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.os.Bundle;
import android.support.v4.widget.SwipeRefreshLayout;
import android.support.v7.app.AppCompatActivity;
import android.support.v7.widget.DefaultItemAnimator;
import android.support.v7.widget.LinearLayoutManager;
import android.support.v7.widget.RecyclerView;
import android.view.Menu;
import android.view.MenuItem;
import android.widget.ProgressBar;
import android.widget.TextView;




public class MainActivity extends AppCompatActivity  {
    private static RecyclerView mRecyclerView;
    private static RecyclerView.Adapter mAdapter;
    private RecyclerView.LayoutManager mLayoutManager;
    private static SwipeRefreshLayout swipeRefreshLayout;
    private static ProgressBar mProgressBar;
    Dbase dHelper;

    Cursor c;
    String ftp ="u376506.ftp.masterhost.ru";
    String login="u376506_tomb";
    String password="coningshern7ur";

    final String LOG_TAG = "myLogs";
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        TextView btn = (TextView) findViewById(R.id.buttonHello);
        swipeRefreshLayout= (SwipeRefreshLayout) findViewById(R.id.swipe);
        swipeRefreshLayout.setColorSchemeColors(new Color().rgb(28,134,238));
        swipeRefreshLayout.setDistanceToTriggerSync(400);
        dHelper=new Dbase(this);
        mRecyclerView = (RecyclerView) findViewById(R.id.my_recycler_view);
        mRecyclerView.setHasFixedSize(true);
        mLayoutManager = new LinearLayoutManager(this);
        mRecyclerView.setLayoutManager(mLayoutManager);
        mRecyclerView.setItemAnimator(new DefaultItemAnimator());
        mProgressBar=(ProgressBar)findViewById(R.id.progressBar);
        new DownloaderAdd(MainActivity.this,mRecyclerView,mProgressBar,getCacheDir()+"").execute(ftp,login,password);
        swipeRefreshLayout.setOnRefreshListener(new SwipeRefreshLayout.OnRefreshListener() {
            @Override
            public void onRefresh() {

                new Downloader(MainActivity.this,mRecyclerView,swipeRefreshLayout,getCacheDir()+"").execute(ftp,login,password);


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
            startActivityForResult(new Intent(this, Add.class),1);
        }

        return super.onOptionsItemSelected(item);
    }
    @Override
    protected void onActivityResult(int requestCode, int resultCode,Intent data) {
        super.onActivityResult(requestCode, resultCode,data);
        if (requestCode == 1 && resultCode == RESULT_OK) {
            new DownloaderAdd(MainActivity.this,mRecyclerView,mProgressBar,getCacheDir()+"").execute(ftp,login,password);
        }
    }

}
