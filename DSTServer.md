## DST Server guide
taken from: https://gist.github.com/thelegendofbrian/442e266f6b7fe2702ee199dca4ce2a61

## Ports used

_Some of the exact port numbers seem to be different between installations. I'm not sure if any **have** to be as listed, but those were **a** working number I used at some point_
| Port  | Description                            | Place Defined     | Open Port | Unique |
|-------|----------------------------------------|-------------------|-----------|--------|
| 11000 | Overworld server port                  | Master/server.ini | x         | x      |
| 11001 | Cave server port                       | Caves/server.ini  | x         | x      |
| 8768  | Steam auth port for overworld          | Master/server.ini |           |        |
| 8769  | Steam auth port for cave               | Caves/server.ini  |           |        |
| 27018 | Steam master server port for overworld | Master/server.ini |           | x      |
| 27019 | Steam master server port for cave      | Caves/server.ini  |           | x      |
| 10888 | Shard master port                      | cluster.ini       |           | x      |

## As sudoer

    sudo su - dstserver

## As `dstserver` user

    wget -O linuxgsm.sh https://linuxgsm.sh && chmod +x linuxgsm.sh

    ./linuxgsm.sh dstserver
    ./linuxgsm.sh dstserver

    mkdir -p ~/lgsm/config-lgsm/dstserver/

### Set LinuxGSM installation variables

    echo '# Installation Variables
    sharding="true"
    master="true"
    shard="Master" 
    cluster="Cluster_1"
    cave="false"' >> ~/lgsm/config-lgsm/dstserver/dstserver.cfg

    echo '# Installation Variables
    sharding="true"
    master="false"
    shard="Caves" 
    cluster="Cluster_1"
    cave="true"' >> ~/lgsm/config-lgsm/dstserver/dstserver-2.cfg

### Set cluster token

    mkdir -p ~/.klei/DoNotStarveTogether/Cluster_1/
    echo 'INSERT_CLUSTER_TOKEN' > ~/.klei/DoNotStarveTogether/Cluster_1/cluster_token.txt

### Install servers

    ./dstserver install
    ./dstserver-2 install

### Configure DST

    mkdir -p ~/.klei/DoNotStarveTogether/Cluster_1/Master/
    mkdir -p ~/.klei/DoNotStarveTogether/Cluster_1/Caves/

### Master/server.ini

    echo '[NETWORK]
    server_port = 11000

    [SHARD]
    is_master = true

    [STEAM]
    authentication_port = 8768
    master_server_port = 27018

    [ACCOUNT]
    encode_user_path = true' > ~/.klei/DoNotStarveTogether/Cluster_1/Master/server.ini

### Caves/server.ini

    echo '[NETWORK]
    server_port = 11001

    [STEAM]
    authentication_port = 8769
    master_server_port = 27019

    [SHARD]
    bind_ip = 127.0.0.1
    is_master = false

    [ACCOUNT]
    encode_user_path = true' > ~/.klei/DoNotStarveTogether/Cluster_1/Caves/server.ini

### cluster.ini

    nano ~/.klei/DoNotStarveTogether/Cluster_1/cluster.ini

Change the relevant line to

    shard_enabled = true
    
### Set the main shard world type to be forest

    echo 'return {
      override_enabled = false,
    }' > ~/.klei/DoNotStarveTogether/Cluster_1/Master/worldgenoverride.lua

    
### Set the cave shard world type to caves

    echo 'return {
      override_enabled = true,
      preset = "DST_CAVE",
    }' > ~/.klei/DoNotStarveTogether/Cluster_1/Caves/worldgenoverride.lua

### Start the servers

    ./dstserver start
    ./dstserver-2 start

## Adding mods

| File             | Path                                          | Purpose |
|------------------|-----------------------------------------------|---------|
| dedicated_server_mods_setup.lua | ~/serverfiles/mods/            | Specify server mods to download next time the server starts    |
| modsettings.lua  | ~/serverfiles/mods/                           | Settings for debugging mods |
| modoverrides.lua | ~/.klei/DoNotStarveTogether/Cluster_1/Master/ | Specify enabled mods for overworld and their configs |
| modoverrides.lua | ~/.klei/DoNotStarveTogether/Cluster_1/Caves/  | Specify enabled mods for caves and their configs |

### Installing Mods

Get workshop ID's of desired mod. To the ~/serverfiles/mods/dedicated_server_mods_setup.lua file, add the following line for each mod.

     ServerModSetup("WorkshopID#")  -- Comments

### Enabling Mods on Server

To the Master and Caves shard located at ~/.klei/DoNotStarveTogether/Cluster_#, add a file

     touch modoverrides.lua

and add the following lines

     return {
       ["workshop-WorkshopID1"] = { enabled = true }, -- Mod 1
       ["workshop-WorkshopID2"] = { enabled = true }, -- Mod 2
                           . . .
       ["workshop-WorkshopID(n-1)"] = { enabled = true },  -- Mod (n-1)
       ["workshop-WorkshopIDn"] = { enabled = true } -- Mod n
     }

Notice that commas are required after each mod except the last one. If there is no caves world, this process only needs to be done to the Master shard.

### Configuring Mods

Auto-generate a modoverrides.lua file by creating a client hosted server with the server mods included and configuring it through the UI before generating the world. After world generation, extract the modoverrides.lua file from the Klei folder in the documents of your personal machine and replace the files created in the previous step with the auto-generated one.
